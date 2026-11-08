export interface LuaTable {
	[key: string]: LuaValue;
}
export type LuaValue = LuaTable | string | number | boolean | null;

export function snapshotMatchesNameSearch(snapshot: LuaValue | undefined, query: string): boolean {
	const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
	if (!terms.length || !isLuaTable(snapshot)) return false;
	return tableValues(snapshot.bags).some((bag) => isLuaTable(bag)
		&& tableValues(bag.items).some((item) => isLuaTable(item)
			&& typeof item.name === 'string'
			&& terms.every((term) => (item.name as string).toLowerCase().includes(term))));
}

type TokenKind = 'identifier' | 'number' | 'string' | 'punctuation' | 'eof';

interface Token {
	kind: TokenKind;
	value: string;
	offset: number;
}

const MAX_SOURCE_LENGTH = 64 * 1024 * 1024;
const MAX_NODES = 1_000_000;
const MAX_DEPTH = 64;

class SavedVariablesParser {
	private offset = 0;
	private tokenCount = 0;
	private readonly source: string;

	constructor(source: string) {
		this.source = source;
		if (source.length > MAX_SOURCE_LENGTH) {
			throw new Error('SavedVariables file is larger than the 64 MiB limit.');
		}
		if (source.charCodeAt(0) === 0xfeff) this.offset = 1;
	}

	parse(): LuaTable {
		this.skipTrivia();
		const name = this.readToken();
		if (name.kind !== 'identifier' || name.value !== 'WhatsInTheBagAccountDB') {
			throw this.error(name.offset, 'Expected the WhatsInTheBagAccountDB assignment.');
		}
		this.expect('=');
		const account = this.parseValue(0);
		if (!this.isTable(account)) {
			throw this.error(name.offset, 'WhatsInTheBagAccountDB must be a table.');
		}
		this.skipTrivia();
		if (this.readToken().kind !== 'eof') {
			throw this.error(this.offset, 'Unexpected content after the SavedVariables table.');
		}
		this.validateSnapshotBranches(account);
		return account;
	}

	private validateSnapshotBranches(account: LuaTable): void {
		const characters = account.characterSnapshots;
		if (characters !== undefined && !this.isTable(characters)) {
			throw new Error('SavedVariables characterSnapshots field must be a table.');
		}
		if (this.isTable(characters)) {
			for (const [key, record] of Object.entries(characters)) {
				if (!this.isTable(record)) {
					throw new Error(`Character snapshot ${key} is not a table.`);
				}
				for (const field of ['bags', 'characterBank'] as const) {
					const snapshot = record[field];
					if (snapshot !== undefined && snapshot !== null && !this.isTable(snapshot)) {
						throw new Error(`Character snapshot ${key}.${field} is not a table.`);
					}
					if (this.isTable(snapshot) && snapshot.bags !== undefined && !this.isTable(snapshot.bags)) {
						throw new Error(`Character snapshot ${key}.${field}.bags is not a table.`);
					}
				}
			}
		}
		const warband = account.warbandSnapshot;
		if (warband !== undefined && warband !== null && !this.isTable(warband)) {
			throw new Error('SavedVariables warbandSnapshot field must be a table.');
		}
		if (this.isTable(warband) && warband.bags !== undefined && !this.isTable(warband.bags)) {
			throw new Error('SavedVariables warbandSnapshot.bags field must be a table.');
		}
	}

	private parseValue(depth: number): LuaValue {
		if (depth > MAX_DEPTH) throw this.error(this.offset, 'SavedVariables nesting is too deep.');
		this.tokenCount += 1;
		if (this.tokenCount > MAX_NODES) throw this.error(this.offset, 'SavedVariables contain too many values.');

		const token = this.readToken();
		if (token.kind === 'string') return token.value;
		if (token.kind === 'number') {
			const number = Number(token.value);
			if (!Number.isFinite(number)) throw this.error(token.offset, 'Invalid numeric value.');
			return number;
		}
		if (token.kind === 'punctuation' && token.value === '{') return this.parseTable(depth + 1);
		if (token.kind === 'identifier') {
			if (token.value === 'true') return true;
			if (token.value === 'false') return false;
			if (token.value === 'nil') return null;
		}
		throw this.error(token.offset, 'Only literal values and table constructors are supported.');
	}

	private parseTable(depth: number): LuaTable {
		const table = Object.create(null) as LuaTable;
		let implicitIndex = 1;

		while (true) {
			const next = this.peekToken();
			if (next.kind === 'punctuation' && next.value === '}') {
				this.readToken();
				return table;
			}
			if (next.kind === 'eof') throw this.error(next.offset, 'Unclosed table constructor.');

			let key: string;
			let value: LuaValue;
			if (next.kind === 'punctuation' && next.value === '[') {
				this.readToken();
				const keyToken = this.readToken();
				if (keyToken.kind !== 'string' && keyToken.kind !== 'number') {
					throw this.error(keyToken.offset, 'Table keys must be literal strings or numbers.');
				}
				if (keyToken.kind === 'number' && !Number.isInteger(Number(keyToken.value))) {
					throw this.error(keyToken.offset, 'Table keys must use integer numbers.');
				}
				key = keyToken.value;
				this.expect(']');
				this.expect('=');
				value = this.parseValue(depth);
			} else if (next.kind === 'identifier') {
				const identifier = this.readToken();
				if (this.peekToken().kind === 'punctuation' && this.peekToken().value === '=') {
					this.readToken();
					key = identifier.value;
					value = this.parseValue(depth);
				} else {
					value = this.identifierValue(identifier);
					key = String(implicitIndex++);
				}
			} else {
				value = this.parseValue(depth);
				key = String(implicitIndex++);
			}

			if (value !== null) table[key] = value;
			const delimiter = this.readToken();
			if (delimiter.kind === 'punctuation' && (delimiter.value === ',' || delimiter.value === ';')) continue;
			if (delimiter.kind === 'punctuation' && delimiter.value === '}') return table;
			throw this.error(delimiter.offset, 'Expected a comma, semicolon, or closing brace in table.');
		}
	}

	private identifierValue(token: Token): LuaValue {
		if (token.value === 'true') return true;
		if (token.value === 'false') return false;
		if (token.value === 'nil') return null;
		throw this.error(token.offset, 'Bare identifiers and expressions are not supported.');
	}

	private expect(value: string): void {
		const token = this.readToken();
		if (token.kind !== 'punctuation' || token.value !== value) {
			throw this.error(token.offset, `Expected '${value}'.`);
		}
	}

	private peekToken(): Token {
		const start = this.offset;
		this.skipTrivia();
		const token = this.readToken();
		this.offset = start;
		return token;
	}

	private readToken(): Token {
		this.skipTrivia();
		const start = this.offset;
		const character = this.source[this.offset];
		if (character === undefined) return { kind: 'eof', value: '', offset: this.offset };

		if ('{}[]=,;'.includes(character)) {
			this.offset += 1;
			return { kind: 'punctuation', value: character, offset: start };
		}
		if (character === '"' || character === "'") return this.readString(character, start);

		const remaining = this.source.slice(this.offset);
		const number = remaining.match(/^-?(?:0[xX][\da-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/);
		if (number) {
			this.offset += number[0].length;
			return { kind: 'number', value: number[0], offset: start };
		}

		const identifier = remaining.match(/^[A-Za-z_][A-Za-z\d_]*/);
		if (identifier) {
			this.offset += identifier[0].length;
			return { kind: 'identifier', value: identifier[0], offset: start };
		}
		throw this.error(start, `Unsupported Lua character '${character}'.`);
	}

	private readString(quote: string, start: number): Token {
		this.offset += 1;
		let value = '';
		while (this.offset < this.source.length) {
			const character = this.source[this.offset++];
			if (character === quote) return { kind: 'string', value, offset: start };
			if (character === '\n' || character === '\r') throw this.error(this.offset - 1, 'Unescaped newline in string.');
			if (character !== '\\') {
				value += character;
				continue;
			}

			if (this.offset >= this.source.length) break;
			const escaped = this.source[this.offset++];
			const simpleEscapes: Record<string, string> = {
				a: '\x07', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\x0b',
				'\\': '\\', '"': '"', "'": "'",
			};
			if (escaped in simpleEscapes) {
				value += simpleEscapes[escaped];
				continue;
			}
			if (escaped === 'z') {
				while (/\s/.test(this.source[this.offset] || '')) this.offset += 1;
				continue;
			}
			if (escaped === 'x') {
				const hex = this.source.slice(this.offset, this.offset + 2);
				if (!/^[\da-fA-F]{2}$/.test(hex)) throw this.error(this.offset, 'Invalid hexadecimal string escape.');
				value += String.fromCharCode(Number.parseInt(hex, 16));
				this.offset += 2;
				continue;
			}
			if (/\d/.test(escaped)) {
				const decimal = escaped + this.source.slice(this.offset, this.offset + 2).match(/^\d{0,2}/)?.[0];
				value += String.fromCharCode(Number.parseInt(decimal, 10) % 256);
				this.offset += decimal.length - 1;
				continue;
			}
			throw this.error(this.offset - 1, `Unsupported string escape '\\${escaped}'.`);
		}
		throw this.error(start, 'Unclosed string.');
	}

	private skipTrivia(): void {
		while (this.offset < this.source.length) {
			if (/\s/.test(this.source[this.offset])) {
				this.offset += 1;
				continue;
			}
			if (this.source.startsWith('--', this.offset)) {
				this.offset += 2;
				while (this.offset < this.source.length && this.source[this.offset] !== '\n') this.offset += 1;
				continue;
			}
			break;
		}
	}

	private isTable(value: LuaValue | undefined): value is LuaTable {
		return typeof value === 'object' && value !== null && !Array.isArray(value);
	}

	private error(offset: number, message: string): Error {
		return new Error(`${message} (character ${offset + 1})`);
	}
}

export function parseSavedVariables(source: string): LuaTable {
	return new SavedVariablesParser(source).parse();
}

export function isLuaTable(value: LuaValue | undefined): value is LuaTable {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function tableValues(value: LuaValue | undefined): LuaValue[] {
	if (!isLuaTable(value)) return [];
	return Object.keys(value)
		.sort((left, right) => {
			const leftNumber = Number(left);
			const rightNumber = Number(right);
			if (Number.isInteger(leftNumber) && Number.isInteger(rightNumber)) return leftNumber - rightNumber;
			return left.localeCompare(right);
		})
		.map((key) => value[key]);
}