import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile, spawn } from "node:child_process";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import { createWriteStream, statSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import net from "node:net";
//#region ../../node_modules/.pnpm/zod@4.6.7/node_modules/zod/v4/core/util.js
function getEnumValues(entries) {
	const numericValues = Object.values(entries).filter((v) => typeof v === "number");
	return Object.entries(entries).filter(([k, _]) => numericValues.indexOf(+k) === -1).map(([_, v]) => v);
}
function joinValues(array, separator = "|") {
	return array.map((val) => stringifyPrimitive(val)).join(separator);
}
function jsonStringifyReplacer(_, value) {
	if (typeof value === "bigint") return value.toString();
	return value;
}
var Cached = class {
	constructor(getter) {
		this._getter = getter;
		this._value = void 0;
	}
	get value() {
		const getter = this._getter;
		if (getter !== void 0) {
			this._value = getter();
			this._getter = void 0;
		}
		return this._value;
	}
};
function cached(getter) {
	return new Cached(getter);
}
function nullish(input) {
	return input === null || input === void 0;
}
function cleanRegex(source) {
	const start = source.startsWith("^") ? 1 : 0;
	const end = source.endsWith("$") ? source.length - 1 : source.length;
	return source.slice(start, end);
}
function floatSafeRemainder(val, step) {
	const ratio = val / step;
	const roundedRatio = Math.round(ratio);
	const tolerance = 4 * Number.EPSILON * Math.max(Math.abs(ratio), 1);
	if (Math.abs(ratio - roundedRatio) < tolerance) return 0;
	return ratio - roundedRatio;
}
function assignProp(target, prop, value) {
	Object.defineProperty(target, prop, {
		value,
		writable: true,
		enumerable: true,
		configurable: true
	});
}
/**
* Whichever object a def's `shape` currently answers from: the one the caller passed until the first read, the frozen copy after it.
*
* Its keys and descriptors read without invoking anything, which is what lets a discriminated union check its discriminator, and the cycle walk read a shape, without resolving a getter that references the schema being constructed. A def that answers `shape` from an accessor of its own has none.
*/
function rawShape(def) {
	const desc = Object.getOwnPropertyDescriptor(def, "shape");
	return desc?.get ? desc.get.raw : desc?.value;
}
function sourceShape(schema) {
	return rawShape(schema._zod.def) ?? schema._zod.def.shape;
}
function deferProp(target, key, getter) {
	Object.defineProperty(target, key, {
		get() {
			const value = getter();
			assignProp(this, key, value);
			return value;
		},
		enumerable: true,
		configurable: true
	});
}
function putProp(target, key, value) {
	if (key in target) assignProp(target, key, value);
	else target[key] = value;
}
/**
* Copies `keys` of `source`'s shape onto `target`, each value passed through `wrap`.
*
* A key the source has resolved is copied through now, so the derived shape states it outright and nothing has to resolve it to learn what it holds. A key the source still defers stays deferred, and reads back through the source's own `shape`, so it resolves once and both shapes get that one schema.
*/
function mirrorShape(target, source, keys, wrap) {
	const raw = sourceShape(source);
	for (const key of keys) {
		const desc = Object.getOwnPropertyDescriptor(raw, key);
		if (!desc.enumerable) continue;
		if (desc.get) deferProp(target, key, () => {
			const value = source._zod.def.shape[key];
			return wrap ? wrap(value, key) : value;
		});
		else putProp(target, key, wrap ? wrap(desc.value, key) : desc.value);
	}
}
function mirrorProps(target, source) {
	for (const key of Reflect.ownKeys(source)) {
		const desc = Object.getOwnPropertyDescriptor(source, key);
		if (!desc.enumerable) continue;
		if (desc.get) deferProp(target, key, () => source[key]);
		else putProp(target, key, desc.value);
	}
}
function mergeDefs(...defs) {
	const mergedDescriptors = {};
	for (const def of defs) {
		const descriptors = Object.getOwnPropertyDescriptors(def);
		Object.assign(mergedDescriptors, descriptors);
	}
	return Object.defineProperties({}, mergedDescriptors);
}
function esc(str) {
	return JSON.stringify(str);
}
function slugify(input) {
	return input.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
}
const captureStackTrace = "captureStackTrace" in Error ? Error.captureStackTrace : (..._args) => {};
function isObject$1(data) {
	return typeof data === "object" && data !== null && !Array.isArray(data);
}
const allowsEval = /* @__PURE__*/ cached(() => {
	if (globalConfig.jitless) return false;
	if (typeof navigator !== "undefined" && navigator?.userAgent?.includes("Cloudflare")) return false;
	try {
		new Function("");
		return true;
	} catch (_) {
		return false;
	}
});
function isPlainObject(o) {
	if (isObject$1(o) === false) return false;
	const ctor = o.constructor;
	if (ctor === void 0) return true;
	if (typeof ctor !== "function") return true;
	const prot = ctor.prototype;
	if (isObject$1(prot) === false) return false;
	if (Object.prototype.hasOwnProperty.call(prot, "isPrototypeOf") === false) return false;
	return true;
}
function shallowClone(o) {
	if (isPlainObject(o)) return { ...o };
	if (Array.isArray(o)) return [...o];
	if (o instanceof Map) return new Map(o);
	if (o instanceof Set) return new Set(o);
	return o;
}
const propertyKeyTypes = /* @__PURE__*/ new Set([
	"string",
	"number",
	"symbol"
]);
function escapeRegex(str) {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function clone(inst, def, params) {
	const cl = new inst._zod.constr(def ?? inst._zod.def);
	if (!def || params?.parent) cl._zod.parent = inst;
	return cl;
}
function normalizeParams(_params) {
	const params = _params;
	if (!params) return {};
	if (typeof params === "string") return { error: () => params };
	if (params?.message !== void 0) {
		if (params?.error !== void 0) throw new Error("Cannot specify both `message` and `error` params");
		params.error = params.message;
	}
	delete params.message;
	if (typeof params.error === "string") return {
		...params,
		error: () => params.error
	};
	return params;
}
function stringifyPrimitive(value) {
	if (typeof value === "bigint") return value.toString() + "n";
	if (typeof value === "string") return `"${value}"`;
	return `${value}`;
}
function optionalKeys(shape) {
	return Object.keys(shape).filter((k) => {
		return shape[k]._zod.optin !== void 0 && shape[k]._zod.optout === "optional";
	});
}
const NUMBER_FORMAT_RANGES = /*@__PURE__*/ (() => ({
	safeint: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
	int32: [-2147483648, 2147483647],
	uint32: [0, 4294967295],
	float32: [-34028234663852886e22, 34028234663852886e22],
	float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
}))();
const BIGINT_FORMAT_RANGES = {
	int64: [/* @__PURE__*/ BigInt("-9223372036854775808"), /* @__PURE__*/ BigInt("9223372036854775807")],
	uint64: [/* @__PURE__*/ BigInt(0), /* @__PURE__*/ BigInt("18446744073709551615")]
};
function pick(schema, mask) {
	const currDef = schema._zod.def;
	const checks = currDef.checks;
	if (checks && checks.length > 0) throw new Error(".pick() cannot be used on object schemas containing refinements");
	const newShape = {};
	mirrorShape(newShape, schema, maskedKeys(schema, mask));
	return clone(schema, mergeDefs(currDef, {
		shape: newShape,
		checks: []
	}));
}
function maskedKeys(schema, mask) {
	const raw = sourceShape(schema);
	const keys = [];
	for (const key of Reflect.ownKeys(mask)) {
		if (!Object.getOwnPropertyDescriptor(raw, key)?.enumerable) throw new Error(`Unrecognized key: "${String(key)}"`);
		if (mask[key]) keys.push(key);
	}
	return keys;
}
function omit(schema, mask) {
	const currDef = schema._zod.def;
	const checks = currDef.checks;
	if (checks && checks.length > 0) throw new Error(".omit() cannot be used on object schemas containing refinements");
	const omitted = new Set(maskedKeys(schema, mask));
	const newShape = {};
	mirrorShape(newShape, schema, Reflect.ownKeys(sourceShape(schema)).filter((key) => !omitted.has(key)));
	return clone(schema, mergeDefs(currDef, {
		shape: newShape,
		checks: []
	}));
}
function extend(schema, shape) {
	if (!isPlainObject(shape)) throw new Error("Invalid input to extend: expected a plain object");
	const checks = schema._zod.def.checks;
	if (checks && checks.length > 0) {
		const existingShape = sourceShape(schema);
		for (const key of Reflect.ownKeys(shape)) if (Object.getOwnPropertyDescriptor(existingShape, key) !== void 0) throw new Error("Cannot overwrite keys on object schemas containing refinements. Use `.safeExtend()` instead.");
	}
	return clone(schema, mergeDefs(schema._zod.def, { shape: extended(schema, shape) }));
}
function extended(schema, shape) {
	const newShape = {};
	mirrorShape(newShape, schema, Reflect.ownKeys(sourceShape(schema)));
	mirrorProps(newShape, shape);
	return newShape;
}
function safeExtend(schema, shape) {
	if (!isPlainObject(shape)) throw new Error("Invalid input to safeExtend: expected a plain object");
	return clone(schema, mergeDefs(schema._zod.def, { shape: extended(schema, shape) }));
}
function merge(a, b) {
	if (!b?._zod?.def) throw new Error("Invalid input to merge: expected an object schema. To merge a plain shape, use `.extend()`.");
	if (a._zod.def.checks?.length) throw new Error(".merge() cannot be used on object schemas containing refinements. Use .safeExtend() instead.");
	const newShape = {};
	mirrorShape(newShape, a, Reflect.ownKeys(sourceShape(a)));
	mirrorShape(newShape, b, Reflect.ownKeys(sourceShape(b)));
	return clone(a, mergeDefs(a._zod.def, {
		shape: newShape,
		get catchall() {
			return b._zod.def.catchall;
		},
		checks: b._zod.def.checks ?? []
	}));
}
function partial(Class, schema, mask, name = "partial") {
	const checks = schema._zod.def.checks;
	if (checks && checks.length > 0) throw new Error(`.${name}() cannot be used on object schemas containing refinements`);
	const selected = mask ? new Set(maskedKeys(schema, mask)) : void 0;
	const newShape = {};
	mirrorShape(newShape, schema, Reflect.ownKeys(sourceShape(schema)), Class && ((value, key) => selected && !selected.has(key) ? value : new Class({
		type: "optional",
		innerType: value
	})));
	return clone(schema, mergeDefs(schema._zod.def, {
		shape: newShape,
		checks: []
	}));
}
function required(Class, schema, mask) {
	const selected = mask ? new Set(maskedKeys(schema, mask)) : void 0;
	const newShape = {};
	mirrorShape(newShape, schema, Reflect.ownKeys(sourceShape(schema)), (value, key) => selected && !selected.has(key) ? value : new Class({
		type: "nonoptional",
		innerType: value
	}));
	return clone(schema, mergeDefs(schema._zod.def, { shape: newShape }));
}
function aborted(x, startIndex = 0) {
	if (x.aborted === true) return true;
	for (let i = startIndex; i < x.issues.length; i++) if (x.issues[i]?.continue !== true) return true;
	return false;
}
function explicitlyAborted(x, startIndex = 0) {
	if (x.aborted === true) return true;
	for (let i = startIndex; i < x.issues.length; i++) if (x.issues[i]?.continue === false) return true;
	return false;
}
function prefixIssues(path, issues) {
	return issues.map((iss) => {
		var _a;
		(_a = iss).path ?? (_a.path = []);
		iss.path.unshift(path);
		return iss;
	});
}
function unwrapMessage(message) {
	return typeof message === "string" ? message : message?.message;
}
/** The leading size checks of `defChecks` that set an upper bound, each paired with it. */
function sizeCaps(defChecks) {
	const caps = [];
	for (const ch of defChecks ?? []) {
		const d = ch._zod.def;
		if (!/_(length|size)$|_equals$/.test(d.check)) break;
		const max = d.maximum ?? d.length ?? d.size;
		if (max >= 0) caps.push([max, ch]);
	}
	return caps;
}
function attachSchema(issues, start, inst) {
	var _a;
	for (let i = start; i < issues.length; i++) (_a = issues[i]).schema ?? (_a.schema = inst);
}
function finalizeIssue(iss, ctx, config) {
	var _a;
	const traits = iss.inst?._zod?.traits;
	if (traits?.has("$ZodType")) {
		if (traits.has("$ZodCheck")) (_a = iss).schema ?? (_a.schema = iss.inst);
		else iss.schema = iss.inst;
	}
	const schemaError = iss.schema !== iss.inst ? iss.schema?._zod.def?.error : void 0;
	const message = iss.message ? iss.message : unwrapMessage(iss.inst?._zod.def?.error?.(iss)) ?? unwrapMessage(schemaError?.(iss)) ?? unwrapMessage(ctx?.error?.(iss)) ?? unwrapMessage(config.customError?.(iss)) ?? unwrapMessage(config.localeError?.(iss)) ?? "Invalid input";
	const full = {};
	for (const k of Object.keys(iss)) {
		if (k === "inst" || k === "schema" || k === "continue" || k === "input" || k === "__proto__") continue;
		full[k] = iss[k];
	}
	full.path ?? (full.path = []);
	full.message = message;
	if (ctx?.reportInput) full.input = iss.input;
	return full;
}
const highSurrogate = /[\uD800-\uDBFF]/;
function codePointLength(str) {
	const units = str.length;
	if (!highSurrogate.test(str)) return units;
	let count = units;
	for (let i = 0; i < units - 1; i++) if ((str.charCodeAt(i) & 64512) === 55296 && (str.charCodeAt(i + 1) & 64512) === 56320) {
		count--;
		i++;
	}
	return count;
}
function getLengthableOrigin(input) {
	if (Array.isArray(input)) return "array";
	if (typeof input === "string") return "string";
	return "unknown";
}
function parsedType(data) {
	const t = typeof data;
	switch (t) {
		case "number": return Number.isNaN(data) ? "nan" : "number";
		case "object": {
			if (data === null) return "null";
			if (Array.isArray(data)) return "array";
			const obj = data;
			if (obj && Object.getPrototypeOf(obj) !== Object.prototype && "constructor" in obj && obj.constructor) return obj.constructor.name;
		}
	}
	return t;
}
function issue(...args) {
	const [iss, input, inst] = args;
	if (typeof iss === "string") return {
		message: iss,
		code: "custom",
		input,
		inst
	};
	return { ...iss };
}
/**
* Installs a trait's members on its prototype. Each value builds that member for the instance on first read; the built value shadows the accessor as an own property, so a detached `const { parse } = schema` keeps working.
*
* Call this from a `proto` initializer, which runs once per prototype — never per instance.
*/
function members(proto, table) {
	for (const key in table) {
		const desc = Object.getOwnPropertyDescriptor(table, key);
		if (desc.get) Object.defineProperty(proto, key, {
			...desc,
			enumerable: false
		});
		else defineBound(proto, key, desc.value);
	}
}
/** Shadows a prototype member with an own value, so a getter that builds from the instance runs once. */
function own(inst, key, value, enumerable = true) {
	Object.defineProperty(inst, key, {
		configurable: true,
		writable: true,
		enumerable,
		value
	});
	return value;
}
/** Like {@link own}, for a member that was never an own data property and has to stay out of `Object.keys`. */
function hide(inst, key, value) {
	return own(inst, key, value, false);
}
/** Adds members a table derives from the instance: each builds on first read and shadows as own data, and assignment shadows the same way, as when these were own properties. */
/* @__NO_SIDE_EFFECTS__ */
function derived(computes, table) {
	for (const key in computes) {
		const compute = computes[key];
		Object.defineProperty(table, key, {
			configurable: true,
			enumerable: true,
			get() {
				return own(this, key, compute(this));
			},
			set(value) {
				own(this, key, value);
			}
		});
	}
	return table;
}
function defineBound(proto, key, fn) {
	Object.defineProperty(proto, key, {
		configurable: true,
		get() {
			return this == null ? fn : own(this, key, fn.bind(this));
		},
		set(value) {
			own(this, key, value);
		}
	});
}
/** Returns the prototype to install on, or `undefined` if this group is already installed on it. */
function claim(inst, sentinel) {
	const proto = Object.getPrototypeOf(inst);
	return sentinel in proto ? void 0 : proto;
}
let installing;
let broke = false;
const breaker = {
	configurable: true,
	get() {
		broke = true;
	}
};
/**
* Installs a lazily-derived internal on the `_zod` prototype of `inst`'s
* constructor, computed from the internals object itself and cached there on
* first read. One accessor per constructor rather than one per instance.
*/
function defineLazyInternal(inst, key, compute) {
	const proto = Object.getPrototypeOf(inst._zod);
	if (key in proto && installing !== inst._zod) {
		installing = void 0;
		return;
	}
	installing = inst._zod;
	Object.defineProperty(proto, key, {
		configurable: true,
		get() {
			Object.defineProperty(this, key, breaker);
			const outer = broke;
			broke = false;
			try {
				const value = compute(this);
				if (broke) delete this[key];
				else Object.defineProperty(this, key, {
					configurable: true,
					writable: true,
					value
				});
				broke = broke || outer;
				return value;
			} catch (err) {
				delete this[key];
				broke = broke || outer;
				throw err;
			}
		},
		set(value) {
			Object.defineProperty(this, key, {
				configurable: true,
				writable: true,
				value
			});
		}
	});
}
/**
* Installs `key` on `inst`'s prototype, computed by `make` on first read and cached there as an own
* data property. One accessor per constructor rather than one per instance, because an own accessor
* puts every instance after the first into v8 dictionary mode. The key doubles as the sentinel.
*/
function installLazyProp(inst, key, make, enumerable) {
	const proto = claim(inst, key);
	if (!proto) return;
	Object.defineProperty(proto, key, {
		configurable: true,
		get() {
			const desc = {
				configurable: true,
				writable: true,
				enumerable,
				value: void 0
			};
			Object.defineProperty(this, key, desc);
			desc.value = make(this);
			Object.defineProperty(this, key, desc);
			return desc.value;
		},
		set(value) {
			Object.defineProperty(this, key, {
				configurable: true,
				writable: true,
				enumerable,
				value
			});
		}
	});
}
/** Marks the thunk `_catch` synthesises for a constant catch value. `Function.length` cannot tell that thunk from a user callback — rest and defaulted parameters both report arity 0 — and a user callback reads `ctx.error`, whose issues only finalize correctly against the caller's per-parse error map. Provenance can say what arity cannot. A plain string key rather than `Symbol.for`, whose call at module scope no bundler can prove pure — the same shape that anchored `urlCanParse` into every build. */
const CONSTANT_CATCH = "~constantCatch";
/** Wraps a constant catch value in a thunk tagged with {@link CONSTANT_CATCH}. */
function constantCatch(value) {
	const fn = () => value;
	fn[CONSTANT_CATCH] = true;
	return fn;
}
//#endregion
//#region ../../node_modules/.pnpm/zod@4.6.7/node_modules/zod/v4/core/core.js
var _a$1;
const _zodDesc = {
	value: void 0,
	enumerable: false
};
let _E = "captureStackTrace" in Error ? Error : null;
function newError(Definition) {
	const E = _E;
	if (E) {
		const saved = E.stackTraceLimit;
		if (typeof saved === "number") {
			try {
				E.stackTraceLimit = 0;
			} catch {
				_E = null;
				return new Definition();
			}
			try {
				return new Definition();
			} finally {
				E.stackTraceLimit = saved;
			}
		}
	}
	return new Definition();
}
/* @__NO_SIDE_EFFECTS__ */
function $constructor(name, initializer, proto, params) {
	const zodProto = {};
	function Internals(def) {
		this.def = def;
		this.constr = _;
		this.traits = /* @__PURE__ */ new Set();
	}
	Internals.prototype = zodProto;
	const protoMembers = proto;
	const initialized = protoMembers && /* @__PURE__ */ new WeakSet();
	function init(inst, def) {
		if (!inst._zod) {
			_zodDesc.value = new Internals(def);
			try {
				Object.defineProperty(inst, "_zod", _zodDesc);
			} finally {
				_zodDesc.value = void 0;
			}
		} else if (inst._zod.traits.has(name)) return;
		inst._zod.traits.add(name);
		initializer(inst, def);
		if (initialized) {
			const own = Object.getPrototypeOf(inst);
			const ctorProto = inst._zod.constr.prototype;
			let up = own;
			while (up && up !== ctorProto) up = Object.getPrototypeOf(up);
			const target = up ?? own;
			if (!initialized.has(target)) {
				initialized.add(target);
				members(target, protoMembers);
			}
		}
		const proto = _.prototype;
		for (const k in proto) {
			if (!Object.prototype.hasOwnProperty.call(proto, k)) continue;
			if (!(k in inst)) inst[k] = proto[k].bind(inst);
		}
	}
	const Parent = params?.Parent ?? Object;
	class Definition extends Parent {}
	Object.defineProperty(Definition, "name", { value: name });
	function _(def) {
		const inst = params?.Parent ? newError(Definition) : this;
		init(inst, def);
		const deferred = inst._zod.deferred;
		if (deferred) {
			for (const fn of deferred) fn();
			inst._zod.deferred = void 0;
		}
		const pp = globalThis.__zod_globalConfig?.postProcessor;
		if (pp) pp(inst);
		return inst;
	}
	Object.defineProperty(_, "init", { value: init });
	Object.defineProperty(_, Symbol.hasInstance, { value: (inst) => {
		if (params?.Parent && inst instanceof params.Parent) return true;
		return inst?._zod?.traits?.has(name);
	} });
	Object.defineProperty(_, "name", { value: name });
	return _;
}
var $ZodAsyncError = class extends Error {
	constructor() {
		super(`Encountered Promise during synchronous parse. Use .parseAsync() instead.`);
	}
};
var $ZodEncodeError = class extends Error {
	constructor(name) {
		super(`Encountered unidirectional transform during encode: ${name}`);
		this.name = "ZodEncodeError";
	}
};
(_a$1 = globalThis).__zod_globalConfig ?? (_a$1.__zod_globalConfig = {});
const globalConfig = globalThis.__zod_globalConfig;
function config(newConfig) {
	if (newConfig) Object.assign(globalConfig, newConfig);
	return globalConfig;
}
//#endregion
//#region ../../node_modules/.pnpm/zod@4.6.7/node_modules/zod/v4/core/errors.js
function _getMessage() {
	const internals = this._zod;
	internals.message ?? (internals.message = JSON.stringify(internals.def, jsonStringifyReplacer, 2));
	return internals.message;
}
function _setMessage(value) {
	this._zod.message = value;
}
const _messageDesc = {
	get: _getMessage,
	set: _setMessage,
	enumerable: true,
	configurable: true
};
const _issuesDesc = {
	value: void 0,
	enumerable: false
};
const _installedToString = /* @__PURE__ */ new WeakSet([Object.prototype, Error.prototype]);
const initializer$1 = (inst, def) => {
	inst.name = "$ZodError";
	_issuesDesc.value = def;
	Object.defineProperty(inst, "issues", _issuesDesc);
	_issuesDesc.value = void 0;
	Object.defineProperty(inst, "message", _messageDesc);
	const proto = Object.getPrototypeOf(inst);
	if (!_installedToString.has(proto)) {
		_installedToString.add(proto);
		Object.defineProperty(proto, "toString", {
			configurable: true,
			enumerable: false,
			get() {
				const value = () => this.message;
				Object.defineProperty(this, "toString", {
					value,
					configurable: true,
					writable: true
				});
				return value;
			},
			set(value) {
				Object.defineProperty(this, "toString", {
					value,
					configurable: true,
					writable: true
				});
			}
		});
	}
};
const $ZodError = /* @__PURE__ */ $constructor("$ZodError", initializer$1);
/** Get-or-create `obj[key]` as an own data property. A path segment naming an inherited member
* ("toString", "constructor") would otherwise read through to the prototype, and assigning
* "__proto__" would hit the setter instead of creating a key. */
function node(obj, key, make) {
	if (!Object.prototype.hasOwnProperty.call(obj, key)) {
		if (key === "__proto__") Object.defineProperty(obj, key, {
			value: make(),
			writable: true,
			enumerable: true,
			configurable: true
		});
		else obj[key] = make();
	}
	return obj[key];
}
function flattenError(error, mapper = (issue) => issue.message) {
	const fieldErrors = {};
	const formErrors = [];
	for (const sub of error.issues) if (sub.path.length > 0) node(fieldErrors, sub.path[0], () => []).push(mapper(sub));
	else formErrors.push(mapper(sub));
	return {
		formErrors,
		fieldErrors
	};
}
function formatError(error, mapper = (issue) => issue.message) {
	const fieldErrors = { _errors: [] };
	const processError = (error, path = []) => {
		for (const issue of error.issues) if (issue.code === "invalid_union" && issue.errors.length) issue.errors.map((issues) => processError({ issues }, [...path, ...issue.path]));
		else if (issue.code === "invalid_key") processError({ issues: issue.issues }, [...path, ...issue.path]);
		else if (issue.code === "invalid_element") processError({ issues: issue.issues }, [...path, ...issue.path]);
		else {
			const fullpath = [...path, ...issue.path];
			if (fullpath.length === 0) fieldErrors._errors.push(mapper(issue));
			else {
				let curr = fieldErrors;
				let i = 0;
				while (i < fullpath.length) {
					const el = fullpath[i];
					const terminal = i === fullpath.length - 1;
					if (el === "_errors") {
						if (terminal) curr._errors.push(mapper(issue));
						i++;
						continue;
					}
					if (!Object.prototype.hasOwnProperty.call(curr, el)) Object.defineProperty(curr, el, {
						value: { _errors: [] },
						enumerable: true,
						writable: true,
						configurable: true
					});
					const node = curr[el];
					if (terminal) node._errors.push(mapper(issue));
					curr = node;
					i++;
				}
			}
		}
	};
	processError(error);
	return fieldErrors;
}
//#endregion
//#region ../../node_modules/.pnpm/zod@4.6.7/node_modules/zod/v4/core/parse.js
function finalizeParams(callee, params) {
	return {
		callee: params?.callee ?? callee,
		Err: params?.Err
	};
}
const _parse = (_Err) => {
	const fn = (schema, value, _ctx, _params) => {
		const ctx = _ctx ? {
			..._ctx,
			async: false
		} : { async: false };
		const result = schema._zod.run({
			value,
			issues: []
		}, ctx);
		if (result instanceof Promise) throw new $ZodAsyncError();
		if (result.issues.length) {
			const e = new ((_params?.Err) ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
			captureStackTrace(e, _params?.callee ?? fn);
			throw e;
		}
		return result.value;
	};
	return fn;
};
const _parseAsync = (_Err) => {
	const fn = async (schema, value, _ctx, params) => {
		const ctx = _ctx ? {
			..._ctx,
			async: true
		} : { async: true };
		let result = schema._zod.run({
			value,
			issues: []
		}, ctx);
		if (result instanceof Promise) result = await result;
		if (result.issues.length) {
			const e = new ((params?.Err) ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
			captureStackTrace(e, params?.callee ?? fn);
			throw e;
		}
		return result.value;
	};
	return fn;
};
const _safeParse = (_Err) => (schema, value, _ctx) => {
	const ctx = _ctx ? {
		..._ctx,
		async: false
	} : { async: false };
	const result = schema._zod.run({
		value,
		issues: []
	}, ctx);
	if (result instanceof Promise) throw new $ZodAsyncError();
	return result.issues.length ? failure(_Err, result.issues, ctx) : {
		success: true,
		data: result.value
	};
};
function failure(Err, issues, ctx) {
	let error;
	return {
		success: false,
		get error() {
			if (!error) {
				error = new Err(issues.map((iss) => finalizeIssue(iss, ctx, config())));
				issues = void 0;
				ctx = void 0;
			}
			return error;
		},
		set error(e) {
			error = e;
			issues = void 0;
			ctx = void 0;
		}
	};
}
const _safeParseAsync = (_Err) => async (schema, value, _ctx) => {
	const ctx = _ctx ? {
		..._ctx,
		async: true
	} : { async: true };
	let result = schema._zod.run({
		value,
		issues: []
	}, ctx);
	if (result instanceof Promise) result = await result;
	return result.issues.length ? failure(_Err, result.issues, ctx) : {
		success: true,
		data: result.value
	};
};
const COMPILE_INVALID = /* @__PURE__ */ Symbol.for("zod.compile.invalid");
const COMPILE_FALLBACK = /* @__PURE__ */ Symbol.for("zod.compile.fallback");
const validate = ((schema, value, _ctx) => {
	const validator = schema._zod.bag.validator;
	if (validator !== void 0) {
		if (validator(value) !== COMPILE_INVALID) return true;
		if (validator.definite === true && _ctx === void 0) return false;
	}
	return validateFallback(schema, value, _ctx);
});
function validateFallback(schema, value, _ctx) {
	const ctx = _ctx ? {
		..._ctx,
		async: false,
		abortEarly: true
	} : {
		async: false,
		abortEarly: true
	};
	const fallbackRun = schema._zod.bag.fallbackRun;
	let result;
	if (fallbackRun) {
		ctx[COMPILE_FALLBACK] = true;
		result = fallbackRun({
			value,
			issues: []
		}, ctx);
	} else result = schema._zod.run({
		value,
		issues: []
	}, ctx);
	if (result instanceof Promise) throw new $ZodAsyncError();
	return result.issues.length === 0;
}
const validateAsync$1 = async (schema, value, _ctx) => {
	const ctx = _ctx ? {
		..._ctx,
		async: true,
		abortEarly: true
	} : {
		async: true,
		abortEarly: true
	};
	let result = schema._zod.run({
		value,
		issues: []
	}, ctx);
	if (result instanceof Promise) result = await result;
	return result.issues.length === 0;
};
const _encode = (_Err) => {
	const parse = _parse(_Err);
	const fn = (schema, value, _ctx, _params) => {
		const ctx = _ctx ? {
			..._ctx,
			direction: "backward"
		} : { direction: "backward" };
		return parse(schema, value, ctx, finalizeParams(fn, _params));
	};
	return fn;
};
const _decode = (_Err) => {
	const parse = _parse(_Err);
	const fn = (schema, value, _ctx, _params) => {
		return parse(schema, value, _ctx, finalizeParams(fn, _params));
	};
	return fn;
};
const _encodeAsync = (_Err) => {
	const parseAsync = _parseAsync(_Err);
	const fn = async (schema, value, _ctx, _params) => {
		const ctx = _ctx ? {
			..._ctx,
			direction: "backward"
		} : { direction: "backward" };
		return await parseAsync(schema, value, ctx, finalizeParams(fn, _params));
	};
	return fn;
};
const _decodeAsync = (_Err) => {
	const parseAsync = _parseAsync(_Err);
	const fn = async (schema, value, _ctx, _params) => {
		return await parseAsync(schema, value, _ctx, finalizeParams(fn, _params));
	};
	return fn;
};
const _safeEncode = (_Err) => (schema, value, _ctx) => {
	const ctx = _ctx ? {
		..._ctx,
		direction: "backward"
	} : { direction: "backward" };
	return _safeParse(_Err)(schema, value, ctx);
};
const _safeDecode = (_Err) => (schema, value, _ctx) => {
	return _safeParse(_Err)(schema, value, _ctx);
};
const _safeEncodeAsync = (_Err) => async (schema, value, _ctx) => {
	const ctx = _ctx ? {
		..._ctx,
		direction: "backward"
	} : { direction: "backward" };
	return _safeParseAsync(_Err)(schema, value, ctx);
};
const _safeDecodeAsync = (_Err) => async (schema, value, _ctx) => {
	return _safeParseAsync(_Err)(schema, value, _ctx);
};
//#endregion
//#region ../../node_modules/.pnpm/zod@4.6.7/node_modules/zod/v4/core/regexes.js
/**
* @deprecated CUID v1 is deprecated by its authors due to information leakage
* (timestamps embedded in the id). Use {@link cuid2} instead.
* See https://github.com/paralleldrive/cuid.
*/
const cuid = /^[cC][0-9a-z]{6,}$/;
const cuid2 = /^[0-9a-z]+$/;
const ulid = /^[0-7][0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{25}$/;
const xid = /^[0-9a-vA-V]{20}$/;
const ksuid = /^[A-Za-z0-9]{27}$/;
const nanoid = /^[a-zA-Z0-9_-]{21}$/;
function nanoidOfLength(length) {
	return new RegExp(`^[a-zA-Z0-9_-]{${length}}$`);
}
/** ISO 8601-1 duration regex. Does not support the 8601-2 extensions like negative durations or fractional/negative components. */
const duration = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/;
/** A regex for any UUID-like identifier: 8-4-4-4-12 hex pattern */
const guid = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;
/** Returns a regex for validating an RFC 9562/4122 UUID.
*
* @param version Optionally specify a version 1-8. If no version is specified, all versions are supported. */
const uuid = (version) => {
	if (!version) return /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;
	return new RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${version}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`);
};
/** Practical email validation */
const email = /^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
const _emoji$1 = `^(?=[\\s\\S]*[\\p{Extended_Pictographic}\\p{Regional_Indicator}\\u20E3])[\\p{Extended_Pictographic}\\p{Emoji_Component}]+$`;
function emoji() {
	return new RegExp(_emoji$1, "u");
}
const ipv4 = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
const ipv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/;
const cidrv4 = /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/;
const cidrv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
const base64 = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/;
const base64url = /^(?:[A-Za-z0-9_-]{4})*(?:[A-Za-z0-9_-]{2,3})?$/;
const httpProtocol = /^https?$/;
const e164 = /^\+[1-9]\d{6,14}$/;
const dateSource = `(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))`;
/** Anchors a pattern source. The interpolation lives here rather than at the call site because
* esbuild will not drop a `@__PURE__` call whose own argument interpolates a variable, but it
* will drop `anchor(dateSource)`. Keeping it inline pinned `date` into every bundle. */
function anchor(source) {
	return new RegExp(`^${source}$`);
}
const date = /*@__PURE__*/ anchor(dateSource);
function timeSource(args) {
	const hhmm = `(?:[01]\\d|2[0-3]):[0-5]\\d`;
	return typeof args.precision === "number" ? args.precision === -1 ? `${hhmm}` : args.precision === 0 ? `${hhmm}:[0-5]\\d` : `${hhmm}:[0-5]\\d\\.\\d{${args.precision}}` : args.seconds ? `${hhmm}:[0-5]\\d(?:\\.\\d+)?` : `${hhmm}(?::[0-5]\\d(?:\\.\\d+)?)?`;
}
function time(args) {
	return new RegExp(`^${timeSource(args)}$`);
}
function datetime$1(args) {
	const opts = ["Z"];
	if (args.offset) opts.push(`([+-](?:[01]\\d|2[0-3]):[0-5]\\d)`);
	const qualified = `${timeSource({
		precision: args.precision,
		seconds: true
	})}(?:${opts.join("|")})`;
	const timeRegex = args.local ? `${qualified}|${timeSource({ precision: args.precision })}` : qualified;
	return new RegExp(`^${dateSource}T(?:${timeRegex})$`);
}
const anyString = /^[\s\S]{0,}$/;
const integer = /^-?\d+$/;
const number$1 = /^-?\d+(?:\.\d+)?$/;
const boolean$1 = /^(?:true|false)$/i;
const lowercase = /^[^A-Z]*$/;
const uppercase = /^[^a-z]*$/;
//#endregion
//#region ../../node_modules/.pnpm/zod@4.6.7/node_modules/zod/v4/core/checks.js
const $ZodCheck = /*@__PURE__*/ $constructor("$ZodCheck", (inst, def) => {
	var _a;
	inst._zod ?? (inst._zod = {});
	inst._zod.def = def;
	(_a = inst._zod).onattach ?? (_a.onattach = []);
});
/** Default `when` for length-based checks: run only on non-nullish values with a `length`. */
const _whenHasLength = (payload) => {
	const val = payload.value;
	return !nullish(val) && val.length !== void 0;
};
const numericOriginMap = {
	number: "number",
	bigint: "bigint",
	object: "date"
};
const $ZodCheckLessThan = /*@__PURE__*/ $constructor("$ZodCheckLessThan", (inst, def) => {
	$ZodCheck.init(inst, def);
	const origin = numericOriginMap[typeof def.value];
	inst._zod.check = (payload) => {
		if (def.inclusive ? payload.value <= def.value : payload.value < def.value) return;
		payload.issues.push({
			origin: numericOriginMap[typeof payload.value] ?? origin,
			code: "too_big",
			maximum: typeof def.value === "object" ? def.value.getTime() : def.value,
			input: payload.value,
			inclusive: def.inclusive,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckGreaterThan = /*@__PURE__*/ $constructor("$ZodCheckGreaterThan", (inst, def) => {
	$ZodCheck.init(inst, def);
	const origin = numericOriginMap[typeof def.value];
	inst._zod.check = (payload) => {
		if (def.inclusive ? payload.value >= def.value : payload.value > def.value) return;
		payload.issues.push({
			origin: numericOriginMap[typeof payload.value] ?? origin,
			code: "too_small",
			minimum: typeof def.value === "object" ? def.value.getTime() : def.value,
			input: payload.value,
			inclusive: def.inclusive,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckMultipleOf = /*@__PURE__*/ $constructor("$ZodCheckMultipleOf", (inst, def) => {
	$ZodCheck.init(inst, def);
	inst._zod.check = (payload) => {
		if (typeof payload.value !== typeof def.value) throw new Error("Cannot mix number and bigint in multiple_of check.");
		if (typeof payload.value === "bigint" ? def.value !== BigInt(0) && payload.value % def.value === BigInt(0) : floatSafeRemainder(payload.value, def.value) === 0) return;
		payload.issues.push({
			origin: typeof payload.value,
			code: "not_multiple_of",
			divisor: def.value,
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckNumberFormat = /*@__PURE__*/ $constructor("$ZodCheckNumberFormat", (inst, def) => {
	$ZodCheck.init(inst, def);
	def.format = def.format || "float64";
	const isInt = def.format?.includes("int");
	const origin = isInt ? "int" : "number";
	const [minimum, maximum] = NUMBER_FORMAT_RANGES[def.format];
	inst._zod.check = (payload) => {
		const input = payload.value;
		if (isInt) {
			if (!Number.isInteger(input)) {
				payload.issues.push({
					expected: origin,
					format: def.format,
					code: "invalid_type",
					continue: false,
					input,
					inst
				});
				return;
			}
			if (!Number.isSafeInteger(input)) {
				if (input > 0) payload.issues.push({
					input,
					code: "too_big",
					maximum: Number.MAX_SAFE_INTEGER,
					note: "Integers must be within the safe integer range.",
					inst,
					origin,
					inclusive: true,
					continue: !def.abort
				});
				else payload.issues.push({
					input,
					code: "too_small",
					minimum: Number.MIN_SAFE_INTEGER,
					note: "Integers must be within the safe integer range.",
					inst,
					origin,
					inclusive: true,
					continue: !def.abort
				});
				return;
			}
		}
		if (input < minimum) payload.issues.push({
			origin: "number",
			input,
			code: "too_small",
			minimum,
			inclusive: true,
			inst,
			continue: !def.abort
		});
		if (input > maximum) payload.issues.push({
			origin: "number",
			input,
			code: "too_big",
			maximum,
			inclusive: true,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckMaxLength = /*@__PURE__*/ $constructor("$ZodCheckMaxLength", (inst, def) => {
	var _a;
	$ZodCheck.init(inst, def);
	(_a = inst._zod.def).when ?? (_a.when = _whenHasLength);
	inst._zod.check = (payload) => {
		const input = payload.value;
		const units = input.length;
		if ((typeof input === "string" && units > def.maximum ? codePointLength(input) : units) <= def.maximum) return;
		const origin = getLengthableOrigin(input);
		payload.issues.push({
			origin,
			code: "too_big",
			maximum: def.maximum,
			inclusive: true,
			input,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckMinLength = /*@__PURE__*/ $constructor("$ZodCheckMinLength", (inst, def) => {
	var _a;
	$ZodCheck.init(inst, def);
	(_a = inst._zod.def).when ?? (_a.when = _whenHasLength);
	inst._zod.check = (payload) => {
		const input = payload.value;
		const units = input.length;
		if ((typeof input === "string" && units >= def.minimum && units < def.minimum * 2 ? codePointLength(input) : units) >= def.minimum) return;
		const origin = getLengthableOrigin(input);
		payload.issues.push({
			origin,
			code: "too_small",
			minimum: def.minimum,
			inclusive: true,
			input,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckLengthEquals = /*@__PURE__*/ $constructor("$ZodCheckLengthEquals", (inst, def) => {
	var _a;
	$ZodCheck.init(inst, def);
	(_a = inst._zod.def).when ?? (_a.when = _whenHasLength);
	inst._zod.check = (payload) => {
		const input = payload.value;
		const units = input.length;
		const length = typeof input === "string" && units >= def.length && units <= def.length * 2 ? codePointLength(input) : units;
		if (length === def.length) return;
		const origin = getLengthableOrigin(input);
		const tooBig = length > def.length;
		payload.issues.push({
			origin,
			...tooBig ? {
				code: "too_big",
				maximum: def.length
			} : {
				code: "too_small",
				minimum: def.length
			},
			inclusive: true,
			exact: true,
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckStringFormat = /*@__PURE__*/ $constructor("$ZodCheckStringFormat", (inst, def) => {
	var _a, _b;
	$ZodCheck.init(inst, def);
	if (def.pattern) (_a = inst._zod).check ?? (_a.check = (payload) => {
		def.pattern.lastIndex = 0;
		if (def.pattern.test(payload.value)) return;
		payload.issues.push({
			origin: "string",
			code: "invalid_format",
			format: def.format,
			input: payload.value,
			...def.pattern ? { pattern: def.pattern.toString() } : {},
			inst,
			continue: !def.abort
		});
	});
	else (_b = inst._zod).check ?? (_b.check = () => {});
});
const $ZodCheckRegex = /*@__PURE__*/ $constructor("$ZodCheckRegex", (inst, def) => {
	$ZodCheckStringFormat.init(inst, def);
	inst._zod.check = (payload) => {
		def.pattern.lastIndex = 0;
		if (def.pattern.test(payload.value)) return;
		payload.issues.push({
			origin: "string",
			code: "invalid_format",
			format: "regex",
			input: payload.value,
			pattern: def.pattern.toString(),
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckLowerCase = /*@__PURE__*/ $constructor("$ZodCheckLowerCase", (inst, def) => {
	def.pattern ?? (def.pattern = lowercase);
	$ZodCheckStringFormat.init(inst, def);
});
const $ZodCheckUpperCase = /*@__PURE__*/ $constructor("$ZodCheckUpperCase", (inst, def) => {
	def.pattern ?? (def.pattern = uppercase);
	$ZodCheckStringFormat.init(inst, def);
});
const $ZodCheckIncludes = /*@__PURE__*/ $constructor("$ZodCheckIncludes", (inst, def) => {
	$ZodCheck.init(inst, def);
	const escapedRegex = escapeRegex(def.includes);
	def.pattern = new RegExp(typeof def.position === "number" ? `^.{${def.position},}${escapedRegex}` : escapedRegex);
	inst._zod.check = (payload) => {
		if (payload.value.includes(def.includes, def.position)) return;
		payload.issues.push({
			origin: "string",
			code: "invalid_format",
			format: "includes",
			includes: def.includes,
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckStartsWith = /*@__PURE__*/ $constructor("$ZodCheckStartsWith", (inst, def) => {
	$ZodCheck.init(inst, def);
	const pattern = new RegExp(`^${escapeRegex(def.prefix)}.*`);
	def.pattern ?? (def.pattern = pattern);
	inst._zod.check = (payload) => {
		if (payload.value.startsWith(def.prefix)) return;
		payload.issues.push({
			origin: "string",
			code: "invalid_format",
			format: "starts_with",
			prefix: def.prefix,
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckEndsWith = /*@__PURE__*/ $constructor("$ZodCheckEndsWith", (inst, def) => {
	$ZodCheck.init(inst, def);
	const pattern = new RegExp(`.*${escapeRegex(def.suffix)}$`);
	def.pattern ?? (def.pattern = pattern);
	inst._zod.check = (payload) => {
		if (payload.value.endsWith(def.suffix)) return;
		payload.issues.push({
			origin: "string",
			code: "invalid_format",
			format: "ends_with",
			suffix: def.suffix,
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckOverwrite = /*@__PURE__*/ $constructor("$ZodCheckOverwrite", (inst, def) => {
	$ZodCheck.init(inst, def);
	inst._zod.check = (payload) => {
		payload.value = def.tx(payload.value);
	};
});
//#endregion
//#region ../../node_modules/.pnpm/zod@4.6.7/node_modules/zod/v4/core/doc.js
var Doc = class {
	constructor(args = [], closed = {}) {
		this.content = [];
		this.indent = 0;
		this.args = args;
		this.closed = closed;
	}
	indented(fn) {
		this.indent += 1;
		try {
			fn(this);
		} finally {
			this.indent -= 1;
		}
	}
	write(arg) {
		if (typeof arg === "function") {
			arg(this, { execution: "sync" });
			arg(this, { execution: "async" });
			return;
		}
		const lines = arg.split("\n").filter((x) => x);
		const minIndent = Math.min(...lines.map((x) => x.length - x.trimStart().length));
		const dedented = lines.map((x) => x.slice(minIndent)).map((x) => " ".repeat(this.indent * 2) + x);
		for (const line of dedented) this.content.push(line);
	}
	compile() {
		const F = Function;
		const content = this?.content ?? [``];
		return new F(...Object.keys(this.closed), `return function (${this.args.join(", ")}) {\n${content.join("\n")}\n};`)(...Object.values(this.closed));
	}
};
//#endregion
//#region ../../node_modules/.pnpm/zod@4.6.7/node_modules/zod/v4/core/versions.js
const version = {
	major: 4,
	minor: 6,
	patch: 7
};
//#endregion
//#region ../../node_modules/.pnpm/zod@4.6.7/node_modules/zod/v4/core/schemas.js
const $ZodType = /*@__PURE__*/ $constructor("$ZodType", (inst, def) => {
	var _a;
	inst ?? (inst = {});
	inst._zod.def = def;
	inst._zod.bag = inst._zod.bag || {};
	inst._zod.version = version;
	const defChecks = inst._zod.def.checks;
	const checks = inst._zod.traits.has("$ZodCheck") ? [inst, ...defChecks ?? []] : defChecks?.length ? [...defChecks] : [];
	for (const ch of checks) for (const fn of ch._zod.onattach) fn(inst);
	if (checks.length === 0) {
		(_a = inst._zod).deferred ?? (_a.deferred = []);
		inst._zod.deferred?.push(() => {
			inst._zod.run = inst._zod.parse;
		});
	} else {
		const runChecks = (payload, checks, ctx) => {
			if (payload.memo) return payload;
			let isAborted = aborted(payload);
			let asyncResult;
			for (const ch of checks) {
				if (ch._zod.def.when) {
					if (explicitlyAborted(payload)) continue;
					if (!ch._zod.def.when(payload)) continue;
				} else if (isAborted) continue;
				const currLen = payload.issues.length;
				const _ = ch._zod.check(payload);
				if (_ instanceof Promise && ctx?.async === false) throw new $ZodAsyncError();
				if (asyncResult || _ instanceof Promise) asyncResult = (asyncResult ?? Promise.resolve()).then(async () => {
					await _;
					if (payload.issues.length === currLen) return;
					attachSchema(payload.issues, currLen, inst);
					if (!isAborted) isAborted = aborted(payload, currLen);
				});
				else {
					if (payload.issues.length === currLen) continue;
					attachSchema(payload.issues, currLen, inst);
					if (!isAborted) isAborted = aborted(payload, currLen);
				}
			}
			if (asyncResult) return asyncResult.then(() => {
				return payload;
			});
			return payload;
		};
		const handleCanaryResult = (canary, payload, ctx) => {
			if (aborted(canary)) {
				canary.aborted = true;
				return canary;
			}
			const checkResult = runChecks(payload, checks, ctx);
			if (checkResult instanceof Promise) {
				if (ctx.async === false) throw new $ZodAsyncError();
				return checkResult.then((checkResult) => inst._zod.parse(checkResult, ctx));
			}
			return inst._zod.parse(checkResult, ctx);
		};
		inst._zod.run = (payload, ctx) => {
			if (ctx.skipChecks) return inst._zod.parse(payload, ctx);
			if (ctx.direction === "backward") {
				const canary = inst._zod.parse({
					value: payload.value,
					issues: []
				}, {
					...ctx,
					skipChecks: true
				});
				if (canary instanceof Promise) return canary.then((canary) => {
					return handleCanaryResult(canary, payload, ctx);
				});
				return handleCanaryResult(canary, payload, ctx);
			}
			const result = inst._zod.parse(payload, ctx);
			if (result instanceof Promise) {
				if (ctx.async === false) throw new $ZodAsyncError();
				return result.then((result) => runChecks(result, checks, ctx));
			}
			return runChecks(result, checks, ctx);
		};
	}
}, {
	get "~standard"() {
		return hide(this, "~standard", standardProps(this));
	},
	set "~standard"(value) {
		own(this, "~standard", value);
	}
});
/** The Standard Schema surface for `inst`. Shared so wrappers can extend it without forcing it. */
const toStandardResult = (r, ctx) => r.issues.length ? { issues: r.issues.map((iss) => finalizeIssue(iss, ctx, config())) } : { value: r.value };
async function validateAsync(inst, value) {
	const ctx = { async: true };
	return toStandardResult(await inst._zod.run({
		value,
		issues: []
	}, ctx), ctx);
}
function standardProps(inst) {
	return {
		validate: (value) => {
			const ctx = { async: false };
			try {
				const r = inst._zod.run({
					value,
					issues: []
				}, ctx);
				if (!(r instanceof Promise)) return toStandardResult(r, ctx);
			} catch (_) {}
			return validateAsync(inst, value);
		},
		vendor: "zod",
		version: 1
	};
}
const $ZodString = /*@__PURE__*/ $constructor("$ZodString", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.pattern = def.pattern ?? anyString;
	inst._zod.parse = (payload, _) => {
		if (def.coerce) try {
			payload.value = String(payload.value);
		} catch (_) {}
		if (typeof payload.value === "string") return payload;
		payload.issues.push({
			expected: "string",
			code: "invalid_type",
			input: payload.value,
			inst
		});
		return payload;
	};
});
const $ZodStringFormat = /*@__PURE__*/ $constructor("$ZodStringFormat", (inst, def) => {
	$ZodCheckStringFormat.init(inst, def);
	$ZodString.init(inst, def);
});
const $ZodGUID = /*@__PURE__*/ $constructor("$ZodGUID", (inst, def) => {
	def.pattern ?? (def.pattern = guid);
	$ZodStringFormat.init(inst, def);
});
const $ZodUUID = /*@__PURE__*/ $constructor("$ZodUUID", (inst, def) => {
	if (def.version) {
		const v = {
			v1: 1,
			v2: 2,
			v3: 3,
			v4: 4,
			v5: 5,
			v6: 6,
			v7: 7,
			v8: 8
		}[def.version];
		if (v === void 0) throw new Error(`Invalid UUID version: "${def.version}"`);
		def.pattern ?? (def.pattern = uuid(v));
	} else def.pattern ?? (def.pattern = uuid());
	$ZodStringFormat.init(inst, def);
});
const $ZodEmail = /*@__PURE__*/ $constructor("$ZodEmail", (inst, def) => {
	def.pattern ?? (def.pattern = email);
	$ZodStringFormat.init(inst, def);
});
function canParseURL(input) {
	try {
		if (typeof URL !== "undefined" && typeof URL.canParse === "function") return URL.canParse(input);
		new URL(input);
		return true;
	} catch {
		return false;
	}
}
function validateURL(trimmed, def) {
	if (!("normalize" in def) && !("hostname" in def) && !("protocol" in def)) return canParseURL(trimmed) || 2;
	return parseURLObject(trimmed, def);
}
/** Parses a URL while preserving the non-normalizing HTTP guard. */
function parseURLObject(trimmed, def) {
	if (!def.normalize && def.protocol?.source === httpProtocol.source && !/^https?:\/\//i.test(trimmed)) return 1;
	try {
		if (typeof URL !== "undefined") {
			const URLStatic = URL;
			if (typeof URLStatic.parse === "function") return URLStatic.parse(trimmed) ?? 2;
		}
		return new URL(trimmed);
	} catch {
		return 2;
	}
}
const asciiTabOrNewline = /[\t\n\r]/g;
/** The URL parser deletes every ASCII tab, LF and CR from its input before it parses, so `new URL("https://exa\nmple.com")` reports on `example.com`. Applying the same deletion to the returned value closes the half of that divergence which can move the host; the parser's other rewrite, stripping C0 controls at the edges, cannot. */
function stripTabAndNewline(value) {
	return value.replace(asciiTabOrNewline, "");
}
function urlHostnameOk(url, hostname) {
	hostname.lastIndex = 0;
	return hostname.test(url.hostname);
}
function urlProtocolOk(url, protocol) {
	protocol.lastIndex = 0;
	return protocol.test(url.protocol.endsWith(":") ? url.protocol.slice(0, -1) : url.protocol);
}
const $ZodURL = /*@__PURE__*/ $constructor("$ZodURL", (inst, def) => {
	$ZodStringFormat.init(inst, def);
	inst._zod.check = (payload) => {
		try {
			const trimmed = payload.value.trim();
			const url = validateURL(trimmed, def);
			if (url === 1) {
				payload.issues.push({
					code: "invalid_format",
					format: "url",
					note: "Invalid URL format",
					input: payload.value,
					inst,
					continue: !def.abort
				});
				return;
			}
			if (url === 2) {
				payload.issues.push({
					code: "invalid_format",
					format: "url",
					input: payload.value,
					inst,
					continue: !def.abort
				});
				return;
			}
			if (url === true) {
				payload.value = stripTabAndNewline(trimmed);
				return;
			}
			if (def.hostname && !urlHostnameOk(url, def.hostname)) payload.issues.push({
				code: "invalid_format",
				format: "url",
				note: "Invalid hostname",
				pattern: def.hostname.source,
				input: payload.value,
				inst,
				continue: !def.abort
			});
			if (def.protocol && !urlProtocolOk(url, def.protocol)) payload.issues.push({
				code: "invalid_format",
				format: "url",
				note: "Invalid protocol",
				pattern: def.protocol.source,
				input: payload.value,
				inst,
				continue: !def.abort
			});
			payload.value = def.normalize ? url.href : stripTabAndNewline(trimmed);
			return;
		} catch (_) {
			payload.issues.push({
				code: "invalid_format",
				format: "url",
				input: payload.value,
				inst,
				continue: !def.abort
			});
		}
	};
});
const $ZodEmoji = /*@__PURE__*/ $constructor("$ZodEmoji", (inst, def) => {
	def.pattern ?? (def.pattern = emoji());
	$ZodStringFormat.init(inst, def);
});
const $ZodNanoID = /*@__PURE__*/ $constructor("$ZodNanoID", (inst, def) => {
	if (def.length !== void 0 && (!Number.isInteger(def.length) || def.length < 1)) throw new Error(`Invalid nanoid length: ${def.length}`);
	def.pattern ?? (def.pattern = def.length === void 0 ? nanoid : nanoidOfLength(def.length));
	$ZodStringFormat.init(inst, def);
});
/**
* @deprecated CUID v1 is deprecated by its authors due to information leakage
* (timestamps embedded in the id). Use {@link $ZodCUID2} instead.
* See https://github.com/paralleldrive/cuid.
*/
const $ZodCUID = /*@__PURE__*/ $constructor("$ZodCUID", (inst, def) => {
	def.pattern ?? (def.pattern = cuid);
	$ZodStringFormat.init(inst, def);
});
const $ZodCUID2 = /*@__PURE__*/ $constructor("$ZodCUID2", (inst, def) => {
	def.pattern ?? (def.pattern = cuid2);
	$ZodStringFormat.init(inst, def);
});
const $ZodULID = /*@__PURE__*/ $constructor("$ZodULID", (inst, def) => {
	def.pattern ?? (def.pattern = ulid);
	$ZodStringFormat.init(inst, def);
});
const $ZodXID = /*@__PURE__*/ $constructor("$ZodXID", (inst, def) => {
	def.pattern ?? (def.pattern = xid);
	$ZodStringFormat.init(inst, def);
});
const $ZodKSUID = /*@__PURE__*/ $constructor("$ZodKSUID", (inst, def) => {
	def.pattern ?? (def.pattern = ksuid);
	$ZodStringFormat.init(inst, def);
});
const $ZodISODateTime = /*@__PURE__*/ $constructor("$ZodISODateTime", (inst, def) => {
	def.pattern ?? (def.pattern = datetime$1(def));
	$ZodStringFormat.init(inst, def);
});
const $ZodISODate = /*@__PURE__*/ $constructor("$ZodISODate", (inst, def) => {
	def.pattern ?? (def.pattern = date);
	$ZodStringFormat.init(inst, def);
});
const $ZodISOTime = /*@__PURE__*/ $constructor("$ZodISOTime", (inst, def) => {
	def.pattern ?? (def.pattern = time(def));
	$ZodStringFormat.init(inst, def);
});
const $ZodISODuration = /*@__PURE__*/ $constructor("$ZodISODuration", (inst, def) => {
	def.pattern ?? (def.pattern = duration);
	$ZodStringFormat.init(inst, def);
});
const $ZodIPv4 = /*@__PURE__*/ $constructor("$ZodIPv4", (inst, def) => {
	def.pattern ?? (def.pattern = ipv4);
	$ZodStringFormat.init(inst, def);
});
/** An IPv6 address is written with hex digits, colons and dots, and nothing else. The guard is what makes the check below an IPv6 check: `new URL("http://[...]")` parses an authority, not an address, so `@` and `\` re-delimit it and `"::@1\\"` validates against the host `0.0.0.1`. The URL parser also deletes ASCII tab, LF and CR rather than failing, which is how `"::1\n"` validated as `::1`. */
const ipv6Alphabet = /^[0-9a-fA-F:.]+$/;
function isValidIPv6(value) {
	if (!ipv6Alphabet.test(value)) return false;
	return canParseURL(`http://[${value}]`);
}
const $ZodIPv6 = /*@__PURE__*/ $constructor("$ZodIPv6", (inst, def) => {
	def.pattern ?? (def.pattern = ipv6);
	$ZodStringFormat.init(inst, def);
	inst._zod.check = (payload) => {
		if (!isValidIPv6(payload.value)) payload.issues.push({
			code: "invalid_format",
			format: "ipv6",
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCIDRv4 = /*@__PURE__*/ $constructor("$ZodCIDRv4", (inst, def) => {
	def.pattern ?? (def.pattern = cidrv4);
	$ZodStringFormat.init(inst, def);
});
function isValidCIDRv6(value) {
	const parts = value.split("/");
	if (parts.length !== 2) return false;
	const [address, prefix] = parts;
	if (!prefix) return false;
	const prefixNum = Number(prefix);
	if (`${prefixNum}` !== prefix) return false;
	if (prefixNum < 0 || prefixNum > 128) return false;
	return isValidIPv6(address);
}
const $ZodCIDRv6 = /*@__PURE__*/ $constructor("$ZodCIDRv6", (inst, def) => {
	def.pattern ?? (def.pattern = cidrv6);
	$ZodStringFormat.init(inst, def);
	inst._zod.check = (payload) => {
		if (!isValidCIDRv6(payload.value)) payload.issues.push({
			code: "invalid_format",
			format: "cidrv6",
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
function isValidBase64(data) {
	if (data === "") return true;
	if (/\s/.test(data)) return false;
	if (data.length % 4 !== 0) return false;
	try {
		atob(data);
		return true;
	} catch {
		return false;
	}
}
const base64Charset = /^[0-9a-zA-Z+/]*={0,2}$/;
const $ZodBase64 = /*@__PURE__*/ $constructor("$ZodBase64", (inst, def) => {
	def.pattern ?? (def.pattern = base64Charset);
	$ZodStringFormat.init(inst, def);
	inst._zod.check = (payload) => {
		if (isValidBase64(payload.value)) return;
		payload.issues.push({
			code: "invalid_format",
			format: "base64",
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
const base64urlCharset = /^[A-Za-z0-9_-]*$/;
function isValidBase64URL(data) {
	if (!base64urlCharset.test(data)) return false;
	const base64 = data.replace(/[-_]/g, (c) => c === "-" ? "+" : "/");
	return isValidBase64(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
}
const $ZodBase64URL = /*@__PURE__*/ $constructor("$ZodBase64URL", (inst, def) => {
	def.pattern ?? (def.pattern = base64urlCharset);
	$ZodStringFormat.init(inst, def);
	inst._zod.check = (payload) => {
		if (isValidBase64URL(payload.value)) return;
		payload.issues.push({
			code: "invalid_format",
			format: "base64url",
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodE164 = /*@__PURE__*/ $constructor("$ZodE164", (inst, def) => {
	def.pattern ?? (def.pattern = e164);
	$ZodStringFormat.init(inst, def);
});
function isValidJWT(token, algorithm = null) {
	try {
		const tokensParts = token.split(".");
		if (tokensParts.length !== 3) return false;
		const [header] = tokensParts;
		if (!header) return false;
		const parsedHeader = JSON.parse(atob(header));
		if ("typ" in parsedHeader && parsedHeader?.typ !== "JWT") return false;
		if (!parsedHeader.alg) return false;
		if (algorithm && (!("alg" in parsedHeader) || parsedHeader.alg !== algorithm)) return false;
		return true;
	} catch {
		return false;
	}
}
const $ZodJWT = /*@__PURE__*/ $constructor("$ZodJWT", (inst, def) => {
	$ZodStringFormat.init(inst, def);
	inst._zod.check = (payload) => {
		if (isValidJWT(payload.value, def.alg)) return;
		payload.issues.push({
			code: "invalid_format",
			format: "jwt",
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodNumber = /*@__PURE__*/ $constructor("$ZodNumber", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.pattern = number$1;
	inst._zod.parse = (payload, _ctx) => {
		if (def.coerce) try {
			payload.value = Number(payload.value);
		} catch (_) {}
		const input = payload.value;
		if (typeof input === "number" && !Number.isNaN(input) && Number.isFinite(input)) return payload;
		const received = typeof input === "number" ? Number.isNaN(input) ? "NaN" : !Number.isFinite(input) ? String(input) : void 0 : void 0;
		payload.issues.push({
			expected: "number",
			code: "invalid_type",
			input,
			inst,
			...received ? { received } : {}
		});
		return payload;
	};
});
const $ZodNumberFormat = /*@__PURE__*/ $constructor("$ZodNumberFormat", (inst, def) => {
	$ZodCheckNumberFormat.init(inst, def);
	$ZodNumber.init(inst, def);
});
const $ZodBoolean = /*@__PURE__*/ $constructor("$ZodBoolean", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.pattern = boolean$1;
	inst._zod.parse = (payload, _ctx) => {
		if (def.coerce) try {
			payload.value = Boolean(payload.value);
		} catch (_) {}
		const input = payload.value;
		if (typeof input === "boolean") return payload;
		payload.issues.push({
			expected: "boolean",
			code: "invalid_type",
			input,
			inst
		});
		return payload;
	};
});
const $ZodUnknown = /*@__PURE__*/ $constructor("$ZodUnknown", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.parse = (payload) => payload;
});
const $ZodNever = /*@__PURE__*/ $constructor("$ZodNever", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.parse = (payload, _ctx) => {
		payload.issues.push({
			expected: "never",
			code: "invalid_type",
			input: payload.value,
			inst
		});
		return payload;
	};
});
function capSize(inst, size) {
	const caps = sizeCaps(inst._zod.def.checks);
	if (!caps.length) return;
	const cap = Math.min(...caps.map((c) => c[0]));
	const parse = inst._zod.parse;
	inst._zod.parse = (payload, ctx) => {
		const n = size(payload.value);
		if (n > cap && !ctx?.skipChecks && ctx?.direction !== "backward") {
			for (const [max, ch] of sizeCaps(inst._zod.def.checks)) if (n > max && ch._zod.def.when(payload)) {
				const start = payload.issues.length;
				ch._zod.check(payload);
				payload.issues[start].continue = false;
				attachSchema(payload.issues, start, inst);
				return payload;
			}
		}
		return parse(payload, ctx);
	};
}
const arraySize = (input) => Array.isArray(input) ? input.length : -1;
function handleArrayResult(result, final, index) {
	if (result.issues.length) final.issues.push(...prefixIssues(index, result.issues));
	final.value[index] = result.value;
}
const $ZodArray = /*@__PURE__*/ $constructor("$ZodArray", (inst, def) => {
	$ZodType.init(inst, def);
	const memo = globalConfig.memoizer;
	memo?.attach(inst);
	inst._zod.parse = (payload, ctx) => {
		const input = payload.value;
		if (!Array.isArray(input)) {
			payload.issues.push({
				expected: "array",
				code: "invalid_type",
				input,
				inst
			});
			return payload;
		}
		payload.value = memo ? memo.alloc(inst, payload, Array(input.length), ctx) : Array(input.length);
		const proms = [];
		const abortEarly = ctx?.abortEarly;
		for (let i = 0; i < input.length; i++) {
			const item = input[i];
			const result = def.element._zod.run({
				value: item,
				issues: []
			}, ctx);
			if (result instanceof Promise) proms.push(result.then((result) => handleArrayResult(result, payload, i)));
			else {
				handleArrayResult(result, payload, i);
				if (abortEarly && result.issues.length !== 0 && aborted(result)) break;
			}
		}
		if (proms.length) return Promise.all(proms).then(() => payload);
		return payload;
	};
	capSize(inst, arraySize);
});
function handlePropertyResult(result, final, key, input, optin, optout) {
	const isPresent = key in input;
	const isOptionalOut = optout === "optional";
	if (!isPresent && isOptionalOut && optin === "optional") return;
	if (result.issues.length) {
		if (optin !== void 0 && isOptionalOut && !isPresent) return;
		final.issues.push(...prefixIssues(key, result.issues));
	}
	if (!isPresent && optin === void 0) {
		if (!result.issues.length) final.issues.push({
			code: "invalid_type",
			expected: "nonoptional",
			input: void 0,
			path: [key]
		});
		return;
	}
	if (result.value === void 0) {
		if (isPresent || optin === "defaulted" && !isOptionalOut) final.value[key] = void 0;
	} else final.value[key] = result.value;
}
const NO_SYMBOL_KEYS = [];
function normalizeDef(def) {
	const keys = Object.keys(def.shape);
	const ownSymbols = Object.getOwnPropertySymbols(def.shape);
	const symbolKeys = ownSymbols.length ? ownSymbols : NO_SYMBOL_KEYS;
	const allKeys = symbolKeys.length ? [...keys, ...symbolKeys] : keys;
	for (const k of allKeys) if (!def.shape?.[k]?._zod?.traits?.has("$ZodType")) throw new Error(`Invalid element at key "${String(k)}": expected a Zod schema`);
	const okeys = optionalKeys(def.shape);
	return {
		...def,
		allKeys,
		symbolKeys,
		keySet: new Set(keys),
		numKeys: keys.length,
		optionalKeys: new Set(okeys)
	};
}
function handleCatchall(proms, input, payload, ctx, def, inst, abortEarly) {
	const unrecognized = [];
	const keySet = def.keySet;
	const _catchall = def.catchall._zod;
	const t = _catchall.def.type;
	const optin = _catchall.optin;
	const optout = _catchall.optout;
	let seen = 0;
	for (const key in input) {
		if (abortEarly && payload.issues.length !== seen) {
			if (aborted(payload, seen)) break;
			seen = payload.issues.length;
		}
		if (keySet.has(key)) continue;
		if (key === "__proto__") {
			if (t === "never") unrecognized.push(key);
			continue;
		}
		if (t === "never") {
			unrecognized.push(key);
			continue;
		}
		const r = _catchall.run({
			value: input[key],
			issues: []
		}, ctx);
		if (r instanceof Promise) proms.push(r.then((r) => handlePropertyResult(r, payload, key, input, optin, optout)));
		else handlePropertyResult(r, payload, key, input, optin, optout);
	}
	if (unrecognized.length) payload.issues.push({
		code: "unrecognized_keys",
		keys: unrecognized,
		input,
		inst,
		continue: true
	});
	if (!proms.length) return payload;
	return Promise.all(proms).then(() => {
		return payload;
	});
}
const $ZodObject = /*@__PURE__*/ $constructor("$ZodObject", (inst, def) => {
	$ZodType.init(inst, def);
	const desc = Object.getOwnPropertyDescriptor(def, "shape");
	const sh = desc?.get ? desc.get.raw : def.shape ?? {};
	if (sh) {
		const get = () => {
			const newSh = { ...sh };
			Object.defineProperty(def, "shape", { value: newSh });
			get.raw = newSh;
			return newSh;
		};
		get.raw = sh;
		Object.defineProperty(def, "shape", { get });
	}
	const _normalized = cached(() => normalizeDef(def));
	defineLazyInternal(inst, "propValues", (zod) => {
		const shape = zod.def.shape;
		const propValues = {};
		for (const key in shape) {
			const field = shape[key]._zod;
			if (field.values) {
				if (!Object.prototype.hasOwnProperty.call(propValues, key)) assignProp(propValues, key, /* @__PURE__ */ new Set());
				for (const v of field.values) propValues[key].add(v);
				if (field.optin !== void 0) propValues[key].add(void 0);
			}
		}
		return propValues;
	});
	const isObject = isObject$1;
	const catchall = def.catchall;
	let value;
	const memo = globalConfig.memoizer;
	memo?.attach(inst);
	inst._zod.parse = (payload, ctx) => {
		value ?? (value = _normalized.value);
		const input = payload.value;
		if (!isObject(input)) {
			payload.issues.push({
				expected: "object",
				code: "invalid_type",
				input,
				inst
			});
			return payload;
		}
		payload.value = memo ? memo.alloc(inst, payload, {}, ctx) : {};
		const proms = [];
		const shape = value.shape;
		const abortEarly = ctx?.abortEarly;
		let seen = payload.issues.length;
		for (const key of value.allKeys) {
			if (abortEarly && payload.issues.length !== seen) {
				if (aborted(payload, seen)) break;
				seen = payload.issues.length;
			}
			if (key === "__proto__") continue;
			const el = shape[key];
			const optin = el._zod.optin;
			const optout = el._zod.optout;
			const r = el._zod.run({
				value: input[key],
				issues: []
			}, ctx);
			if (r instanceof Promise) proms.push(r.then((r) => handlePropertyResult(r, payload, key, input, optin, optout)));
			else handlePropertyResult(r, payload, key, input, optin, optout);
		}
		if (!catchall) return proms.length ? Promise.all(proms).then(() => payload) : payload;
		return handleCatchall(proms, input, payload, ctx, _normalized.value, inst, abortEarly === true);
	};
});
const $ZodObjectJIT = /*@__PURE__*/ $constructor("$ZodObjectJIT", (inst, def) => {
	$ZodObject.init(inst, def);
	const superParse = inst._zod.parse;
	const _normalized = cached(() => normalizeDef(def));
	const memo = globalConfig.memoizer;
	const generateFastpass = (shape) => {
		const normalized = _normalized.value;
		const syms = normalized.symbolKeys;
		const doc = new Doc(["payload", "ctx"], {
			shape,
			inst,
			memo,
			syms
		});
		const parseStr = (k) => `shape[${k}]._zod.run({ value: input[${k}], issues: [] }, ctx)`;
		const prefixStr = (id, k) => `
          let ${id}_ab = false;
          for (let i = 0; i < ${id}.issues.length; i++) {
            const iss = ${id}.issues[i];
            iss.path = iss.path ? [${k}, ...iss.path] : [${k}];
            payload.issues.push(iss);
            if (iss.continue !== true) ${id}_ab = true;
          }
          if (${id}_ab && ctx && ctx.abortEarly) {
            payload.value = newResult;
            return payload;
          }`;
		doc.write(`const input = payload.value;`);
		const ids = Object.create(null);
		let counter = 0;
		for (const key of normalized.allKeys) ids[key] = `key_${counter++}`;
		doc.write(memo ? `const newResult = memo.alloc(inst, payload, {}, ctx);` : `const newResult = {};`);
		for (const key of normalized.allKeys) {
			if (key === "__proto__") continue;
			const id = ids[key];
			const k = typeof key === "symbol" ? `syms[${syms.indexOf(key)}]` : esc(key);
			const isPresent = `${k} in input`;
			const schema = shape[key];
			const optin = schema?._zod?.optin;
			const isOptionalIn = optin !== void 0;
			const isOptionalOut = schema?._zod?.optout === "optional";
			doc.write(`const ${id} = ${parseStr(k)};`);
			if (isOptionalIn && isOptionalOut) {
				const assign = optin === "optional" ? `${id}_present` : `${id}.value !== undefined || ${id}_present`;
				doc.write(`
        const ${id}_present = ${isPresent};
        if (!${id}.issues.length || ${id}_present) {
          if (${id}.issues.length) {${prefixStr(id, k)}
          }

          if (${assign}) {
            newResult[${k}] = ${id}.value;
          }
        }

      `);
			} else if (!isOptionalIn) doc.write(`
        const ${id}_present = ${isPresent};
        if (${id}.issues.length) {${prefixStr(id, k)}
        }
        if (!${id}_present && !${id}.issues.length) {
          payload.issues.push({
            code: "invalid_type",
            expected: "nonoptional",
            input: undefined,
            path: [${k}]
          });
          if (ctx && ctx.abortEarly) {
            payload.value = newResult;
            return payload;
          }
        }

        if (${id}_present) {
          newResult[${k}] = ${id}.value;
        }

      `);
			else {
				doc.write(`
        if (${id}.issues.length) {${prefixStr(id, k)}
        }
      `);
				if (optin === "defaulted") doc.write(`newResult[${k}] = ${id}.value;`);
				else doc.write(`
        if (${id}.value !== undefined || ${isPresent}) {
          newResult[${k}] = ${id}.value;
        }
      `);
			}
		}
		doc.write(`payload.value = newResult;`);
		doc.write(`return payload;`);
		return doc.compile();
	};
	let fastpass;
	const isObject = isObject$1;
	const jit = !globalConfig.jitless;
	const fastEnabled = jit && allowsEval.value;
	const catchall = def.catchall;
	let value;
	inst._zod.parse = (payload, ctx) => {
		value ?? (value = _normalized.value);
		const input = payload.value;
		if (!isObject(input)) {
			payload.issues.push({
				expected: "object",
				code: "invalid_type",
				input,
				inst
			});
			return payload;
		}
		if (jit && fastEnabled && ctx?.async === false && ctx.jitless !== true) {
			if (!fastpass) fastpass = generateFastpass(def.shape);
			payload = fastpass(payload, ctx);
			if (!catchall) return payload;
			return handleCatchall([], input, payload, ctx, value, inst, ctx?.abortEarly === true);
		}
		return superParse(payload, ctx);
	};
});
function handleUnionResults(results, final, inst, ctx) {
	for (const result of results) if (result.issues.length === 0) {
		final.value = result.value;
		return final;
	}
	const nonaborted = results.filter((r) => !aborted(r));
	if (nonaborted.length === 1) {
		final.value = nonaborted[0].value;
		return nonaborted[0];
	}
	final.issues.push({
		code: "invalid_union",
		input: final.value,
		inst,
		errors: results.map((result) => result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
	});
	return final;
}
const $ZodUnion = /*@__PURE__*/ $constructor("$ZodUnion", (inst, def) => {
	$ZodType.init(inst, def);
	defineLazyInternal(inst, "optin", (zod) => zod.def.options.some((o) => o._zod.optin === "defaulted") ? "defaulted" : zod.def.options.some((o) => o._zod.optin !== void 0) ? "optional" : void 0);
	defineLazyInternal(inst, "optout", (zod) => zod.def.options.some((o) => o._zod.optout === "optional") ? "optional" : void 0);
	defineLazyInternal(inst, "values", (zod) => {
		if (zod.def.options.every((o) => o._zod.values)) return new Set(zod.def.options.flatMap((option) => Array.from(option._zod.values)));
	});
	defineLazyInternal(inst, "pattern", (zod) => {
		if (zod.def.options.every((o) => o._zod.pattern)) {
			const patterns = zod.def.options.map((o) => o._zod.pattern);
			return new RegExp(`^(${patterns.map((p) => cleanRegex(p.source)).join("|")})$`);
		}
	});
	const first = def.options.length === 1 ? def.options[0]._zod.run : null;
	inst._zod.parse = (payload, ctx) => {
		if (first) return first(payload, ctx);
		let async = false;
		const results = [];
		for (const option of def.options) {
			const result = option._zod.run({
				value: payload.value,
				issues: []
			}, ctx);
			if (result instanceof Promise) {
				results.push(result);
				async = true;
			} else {
				if (result.issues.length === 0) return result;
				results.push(result);
			}
		}
		if (!async) return handleUnionResults(results, payload, inst, ctx);
		return Promise.all(results).then((results) => {
			return handleUnionResults(results, payload, inst, ctx);
		});
	};
});
function discriminatorMap(def) {
	const map = /* @__PURE__ */ new Map();
	for (const option of def.options) {
		const values = option._zod.propValues?.[def.discriminator];
		if (!values || values.size === 0) throw new Error(`Invalid discriminated union option at index "${def.options.indexOf(option)}"`);
		for (const value of values) if (map.has(value)) {
			if (value !== void 0) throw new Error(`Duplicate discriminator value "${String(value)}"`);
			map.set(value, null);
		} else map.set(value, option);
	}
	return map;
}
const $ZodDiscriminatedUnion = /*@__PURE__*/ $constructor("$ZodDiscriminatedUnion", (inst, def) => {
	def.inclusive = false;
	$ZodUnion.init(inst, def);
	const _super = inst._zod.parse;
	defineLazyInternal(inst, "propValues", (zod) => {
		const propValues = {};
		let undefinedCount = 0;
		for (const option of zod.def.options) {
			const pv = option._zod.propValues;
			if (!pv || Object.keys(pv).length === 0) throw new Error(`Invalid discriminated union option at index "${zod.def.options.indexOf(option)}"`);
			if (pv[zod.def.discriminator]?.has(void 0)) undefinedCount++;
			for (const [k, v] of Object.entries(pv)) {
				if (!Object.prototype.hasOwnProperty.call(propValues, k)) assignProp(propValues, k, /* @__PURE__ */ new Set());
				for (const val of v) propValues[k].add(val);
			}
		}
		if (!zod.def.unionFallback && undefinedCount > 1) propValues[zod.def.discriminator]?.delete(void 0);
		return propValues;
	});
	def.options.forEach((option, i) => {
		const propShape = rawShape(option._zod.def);
		if (propShape && !Object.prototype.hasOwnProperty.call(propShape, def.discriminator)) throw new Error(`Invalid discriminated union option at index "${i}"`);
	});
	const disc = cached(() => discriminatorMap(def));
	inst._zod.parse = (payload, ctx) => {
		const input = payload.value;
		if (!isObject$1(input)) {
			payload.issues.push({
				code: "invalid_type",
				expected: "object",
				input,
				inst
			});
			return payload;
		}
		const value = input?.[def.discriminator];
		const opt = disc.value.get(value);
		if (opt && (value !== void 0 || ctx.direction !== "backward")) return opt._zod.run(payload, ctx);
		if (def.unionFallback || ctx.direction === "backward") return _super(payload, ctx);
		payload.issues.push({
			code: "invalid_union",
			errors: [],
			note: "No matching discriminator",
			discriminator: def.discriminator,
			options: Array.from(disc.value.keys()).filter((value) => disc.value.get(value) !== null),
			input,
			path: [def.discriminator],
			inst
		});
		return payload;
	};
});
const $ZodIntersection = /*@__PURE__*/ $constructor("$ZodIntersection", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.parse = (payload, ctx) => {
		const input = payload.value;
		const left = def.left._zod.run({
			value: input,
			issues: []
		}, ctx);
		const right = def.right._zod.run({
			value: input,
			issues: []
		}, ctx);
		if (left instanceof Promise || right instanceof Promise) return Promise.all([left, right]).then(([left, right]) => {
			return handleIntersectionResults(payload, left, right);
		});
		return handleIntersectionResults(payload, left, right);
	};
});
function mergeValues(a, b) {
	if (a === b) return {
		valid: true,
		data: a
	};
	if (a instanceof Date && b instanceof Date && +a === +b) return {
		valid: true,
		data: a
	};
	if (isPlainObject(a) && isPlainObject(b)) {
		const bKeys = Object.keys(b);
		const sharedKeys = Object.keys(a).filter((key) => bKeys.indexOf(key) !== -1);
		const newObj = {
			...a,
			...b
		};
		if (Object.prototype.hasOwnProperty.call(newObj, "__proto__")) delete newObj.__proto__;
		for (const key of sharedKeys) {
			if (key === "__proto__") continue;
			const sharedValue = mergeValues(a[key], b[key]);
			if (!sharedValue.valid) return {
				valid: false,
				mergeErrorPath: [key, ...sharedValue.mergeErrorPath]
			};
			newObj[key] = sharedValue.data;
		}
		return {
			valid: true,
			data: newObj
		};
	}
	if (Array.isArray(a) && Array.isArray(b)) {
		if (a.length !== b.length) return {
			valid: false,
			mergeErrorPath: []
		};
		const newArray = [];
		for (let index = 0; index < a.length; index++) {
			const itemA = a[index];
			const itemB = b[index];
			const sharedValue = mergeValues(itemA, itemB);
			if (!sharedValue.valid) return {
				valid: false,
				mergeErrorPath: [index, ...sharedValue.mergeErrorPath]
			};
			newArray.push(sharedValue.data);
		}
		return {
			valid: true,
			data: newArray
		};
	}
	return {
		valid: false,
		mergeErrorPath: []
	};
}
function handleIntersectionResults(result, left, right) {
	const unrecKeys = /* @__PURE__ */ new Map();
	let unrecIssue;
	const keyIssues = /* @__PURE__ */ new Map();
	const collect = (iss, side) => {
		let keys;
		if (iss.code === "unrecognized_keys" && !iss.path?.length) {
			unrecIssue ?? (unrecIssue = iss);
			keys = iss.keys;
		} else if (iss.code === "invalid_key" && iss.origin === "record" && iss.path?.length === 1) {
			const k = String(iss.path[0]);
			if (!keyIssues.has(k)) keyIssues.set(k, iss);
			keys = [k];
		} else return false;
		for (const k of keys) {
			if (!unrecKeys.has(k)) unrecKeys.set(k, {});
			unrecKeys.get(k)[side] = true;
		}
		return true;
	};
	for (const iss of left.issues) if (!collect(iss, "l")) result.issues.push(iss);
	for (const iss of right.issues) if (!collect(iss, "r")) result.issues.push(iss);
	const bothKeys = [...unrecKeys].filter(([, f]) => f.l && f.r).map(([k]) => k);
	if (bothKeys.length) {
		const aggregated = unrecIssue ? bothKeys.filter((k) => unrecIssue.keys.includes(k)) : [];
		if (aggregated.length) result.issues.push({
			...unrecIssue,
			keys: aggregated
		});
		for (const k of bothKeys) if (!aggregated.includes(k) && keyIssues.has(k)) result.issues.push(keyIssues.get(k));
	}
	const merged = mergeValues(left.value, right.value);
	if (!merged.valid) {
		if (aborted(result)) return result;
		throw new Error(`Unmergable intersection. Error path: ${JSON.stringify(merged.mergeErrorPath)}`);
	}
	result.value = merged.data;
	return result;
}
const $ZodRecord = /*@__PURE__*/ $constructor("$ZodRecord", (inst, def) => {
	$ZodType.init(inst, def);
	const memo = globalConfig.memoizer;
	memo?.attach(inst);
	inst._zod.parse = (payload, ctx) => {
		const input = payload.value;
		if (!isPlainObject(input)) {
			payload.issues.push({
				expected: "record",
				code: "invalid_type",
				input,
				inst
			});
			return payload;
		}
		const proms = [];
		const values = def.keyType._zod.values;
		if (values && !def.partial) {
			payload.value = memo ? memo.alloc(inst, payload, {}, ctx) : {};
			const recordKeys = /* @__PURE__ */ new Set();
			for (const key of values) if (typeof key === "string" || typeof key === "number" || typeof key === "symbol") {
				recordKeys.add(typeof key === "number" ? key.toString() : key);
				if (key === "__proto__") continue;
				const keyResult = def.keyType._zod.run({
					value: key,
					issues: []
				}, ctx);
				if (keyResult instanceof Promise) throw new Error("Async schemas not supported in object keys currently");
				if (keyResult.issues.length) {
					payload.issues.push({
						code: "invalid_key",
						origin: "record",
						issues: keyResult.issues.map((iss) => finalizeIssue(iss, ctx, config())),
						input: key,
						path: [key],
						inst
					});
					continue;
				}
				const outKey = keyResult.value;
				if (outKey === "__proto__") continue;
				const result = def.valueType._zod.run({
					value: input[key],
					issues: []
				}, ctx);
				if (result instanceof Promise) proms.push(result.then((result) => {
					if (result.issues.length) payload.issues.push(...prefixIssues(key, result.issues));
					payload.value[outKey] = result.value;
				}));
				else {
					if (result.issues.length) payload.issues.push(...prefixIssues(key, result.issues));
					payload.value[outKey] = result.value;
				}
			}
			let unrecognized;
			for (const key in input) if (!recordKeys.has(key)) {
				if (def.mode === "loose") {
					if (key === "__proto__") continue;
					payload.value[key] = input[key];
				} else {
					unrecognized = unrecognized ?? [];
					unrecognized.push(key);
				}
			}
			if (unrecognized && unrecognized.length > 0) payload.issues.push({
				code: "unrecognized_keys",
				input,
				inst,
				keys: unrecognized,
				continue: true
			});
		} else {
			payload.value = memo ? memo.alloc(inst, payload, {}, ctx) : {};
			let unrecognized;
			for (const key of Reflect.ownKeys(input)) {
				if (key === "__proto__") continue;
				if (!Object.prototype.propertyIsEnumerable.call(input, key)) continue;
				let keyResult = def.keyType._zod.run({
					value: key,
					issues: []
				}, ctx);
				if (keyResult instanceof Promise) throw new Error("Async schemas not supported in object keys currently");
				if (typeof key === "string" && number$1.test(key) && keyResult.issues.length) {
					const retryResult = def.keyType._zod.run({
						value: Number(key),
						issues: []
					}, ctx);
					if (retryResult instanceof Promise) throw new Error("Async schemas not supported in object keys currently");
					if (retryResult.issues.length === 0) keyResult = retryResult;
				}
				if (keyResult.issues.length) {
					if (def.mode === "loose") payload.value[key] = input[key];
					else if (values) {
						unrecognized = unrecognized ?? [];
						unrecognized.push(key);
					} else payload.issues.push({
						code: "invalid_key",
						origin: "record",
						issues: keyResult.issues.map((iss) => finalizeIssue(iss, ctx, config())),
						input: key,
						path: [key],
						inst
					});
					continue;
				}
				const outKey = keyResult.value;
				if (outKey === "__proto__") continue;
				const result = def.valueType._zod.run({
					value: input[key],
					issues: []
				}, ctx);
				if (result instanceof Promise) proms.push(result.then((result) => {
					if (result.issues.length) payload.issues.push(...prefixIssues(key, result.issues));
					payload.value[outKey] = result.value;
				}));
				else {
					if (result.issues.length) payload.issues.push(...prefixIssues(key, result.issues));
					payload.value[outKey] = result.value;
				}
			}
			if (unrecognized && unrecognized.length > 0) payload.issues.push({
				code: "unrecognized_keys",
				input,
				inst,
				keys: unrecognized,
				continue: true
			});
		}
		if (proms.length) return Promise.all(proms).then(() => payload);
		return payload;
	};
});
const $ZodEnum = /*@__PURE__*/ $constructor("$ZodEnum", (inst, def) => {
	$ZodType.init(inst, def);
	const values = getEnumValues(def.entries);
	const valuesSet = new Set(values);
	inst._zod.values = valuesSet;
	defineLazyInternal(inst, "pattern", (zod) => {
		const patternValues = getEnumValues(zod.def.entries).filter((k) => propertyKeyTypes.has(typeof k));
		return new RegExp(patternValues.length ? `^(${patternValues.map((o) => escapeRegex(o.toString())).join("|")})$` : "^[^\\s\\S]$");
	});
	inst._zod.parse = (payload, _ctx) => {
		const input = payload.value;
		if (valuesSet.has(input)) return payload;
		payload.issues.push({
			code: "invalid_value",
			values,
			input,
			inst
		});
		return payload;
	};
});
const $ZodLiteral = /*@__PURE__*/ $constructor("$ZodLiteral", (inst, def) => {
	$ZodType.init(inst, def);
	const values = new Set(def.values);
	inst._zod.values = values;
	defineLazyInternal(inst, "pattern", (zod) => {
		const vals = zod.def.values;
		return new RegExp(vals.length ? `^(${vals.map((o) => typeof o === "string" ? escapeRegex(o) : o ? escapeRegex(o.toString()) : String(o)).join("|")})$` : "^[^\\s\\S]$");
	});
	inst._zod.parse = (payload, _ctx) => {
		const input = payload.value;
		if (values.has(input)) return payload;
		payload.issues.push({
			code: "invalid_value",
			values: def.values,
			input,
			inst
		});
		return payload;
	};
});
const $ZodTransform = /*@__PURE__*/ $constructor("$ZodTransform", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.optin = "optional";
	globalConfig.memoizer?.guard(inst);
	inst._zod.parse = (payload, ctx) => {
		if (ctx.direction === "backward") throw new $ZodEncodeError(inst.constructor.name);
		const _out = def.transform(payload.value, payload);
		if (ctx.async) return (_out instanceof Promise ? _out : Promise.resolve(_out)).then((output) => {
			payload.value = output;
			return payload;
		});
		if (_out instanceof Promise) throw new $ZodAsyncError();
		payload.value = _out;
		return payload;
	};
});
function handleOptionalResult(payload, result) {
	payload.value = result.issues.length ? void 0 : result.value;
	return payload;
}
const $ZodOptional = /*@__PURE__*/ $constructor("$ZodOptional", (inst, def) => {
	$ZodType.init(inst, def);
	defineLazyInternal(inst, "optin", (zod) => zod.def.innerType._zod.optin === "defaulted" ? "defaulted" : "optional");
	inst._zod.optout = "optional";
	defineLazyInternal(inst, "values", (zod) => {
		const values = zod.def.innerType._zod.values;
		return values ? /* @__PURE__ */ new Set([...values, void 0]) : void 0;
	});
	defineLazyInternal(inst, "pattern", (zod) => {
		const pattern = zod.def.innerType._zod.pattern;
		return pattern ? new RegExp(`^(${cleanRegex(pattern.source)})?$`) : void 0;
	});
	inst._zod.parse = (payload, ctx) => {
		if (payload.value === void 0) {
			if (def.innerType._zod.optin !== "defaulted") return payload;
			const result = def.innerType._zod.run({
				value: payload.value,
				issues: []
			}, ctx);
			if (result instanceof Promise) return result.then((result) => handleOptionalResult(payload, result));
			return handleOptionalResult(payload, result);
		}
		return def.innerType._zod.run(payload, ctx);
	};
});
const $ZodExactOptional = /*@__PURE__*/ $constructor("$ZodExactOptional", (inst, def) => {
	$ZodOptional.init(inst, def);
	defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
	defineLazyInternal(inst, "pattern", (zod) => zod.def.innerType._zod.pattern);
	inst._zod.parse = (payload, ctx) => {
		return def.innerType._zod.run(payload, ctx);
	};
});
const $ZodNullable = /*@__PURE__*/ $constructor("$ZodNullable", (inst, def) => {
	$ZodType.init(inst, def);
	defineLazyInternal(inst, "optin", (zod) => zod.def.innerType._zod.optin);
	defineLazyInternal(inst, "optout", (zod) => zod.def.innerType._zod.optout);
	defineLazyInternal(inst, "pattern", (zod) => {
		const pattern = zod.def.innerType._zod.pattern;
		return pattern ? new RegExp(`^(${cleanRegex(pattern.source)}|null)$`) : void 0;
	});
	defineLazyInternal(inst, "values", (zod) => {
		return zod.def.innerType._zod.values ? /* @__PURE__ */ new Set([...zod.def.innerType._zod.values, null]) : void 0;
	});
	inst._zod.parse = (payload, ctx) => {
		if (payload.value === null) return payload;
		return def.innerType._zod.run(payload, ctx);
	};
});
const $ZodDefault = /*@__PURE__*/ $constructor("$ZodDefault", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.optin = "defaulted";
	defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
	inst._zod.parse = (payload, ctx) => {
		if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
		if (payload.value === void 0) {
			payload.value = def.defaultValue;
			/**
			* $ZodDefault returns the default value immediately in forward direction.
			* It doesn't pass the default value into the validator ("prefault"). There's no reason to pass the default value through validation. The validity of the default is enforced by TypeScript statically. Otherwise, it's the responsibility of the user to ensure the default is valid. In the case of pipes with divergent in/out types, you can specify the default on the `in` schema of your ZodPipe to set a "prefault" for the pipe.   */
			return payload;
		}
		const result = def.innerType._zod.run(payload, ctx);
		if (result instanceof Promise) return result.then((result) => handleDefaultResult(result, def));
		return handleDefaultResult(result, def);
	};
});
function handleDefaultResult(payload, def) {
	if (payload.value === void 0) payload.value = def.defaultValue;
	return payload;
}
const $ZodPrefault = /*@__PURE__*/ $constructor("$ZodPrefault", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.optin = "defaulted";
	defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
	inst._zod.parse = (payload, ctx) => {
		if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
		if (payload.value === void 0) payload.value = def.defaultValue;
		return def.innerType._zod.run(payload, ctx);
	};
});
const $ZodNonOptional = /*@__PURE__*/ $constructor("$ZodNonOptional", (inst, def) => {
	$ZodType.init(inst, def);
	defineLazyInternal(inst, "values", (zod) => {
		const v = zod.def.innerType._zod.values;
		return v ? new Set([...v].filter((x) => x !== void 0)) : void 0;
	});
	inst._zod.parse = (payload, ctx) => {
		const result = def.innerType._zod.run(payload, ctx);
		if (result instanceof Promise) return result.then((result) => handleNonOptionalResult(result, inst));
		return handleNonOptionalResult(result, inst);
	};
});
function handleNonOptionalResult(payload, inst) {
	if (!payload.issues.length && payload.value === void 0) payload.issues.push({
		code: "invalid_type",
		expected: "nonoptional",
		input: payload.value,
		inst
	});
	return payload;
}
function handleCatchResult(payload, result, def, ctx) {
	if (!result.issues.length) {
		payload.value = result.value;
		if (result.memo) payload.memo = true;
		return payload;
	}
	payload.value = def.catchValue({
		...result,
		value: payload.value,
		error: { issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config())) },
		input: payload.value
	});
	return payload;
}
const $ZodCatch = /*@__PURE__*/ $constructor("$ZodCatch", (inst, def) => {
	$ZodType.init(inst, def);
	defineLazyInternal(inst, "optin", (zod) => zod.def.innerType._zod.optin === "defaulted" ? "defaulted" : "optional");
	defineLazyInternal(inst, "optout", (zod) => zod.def.innerType._zod.optout);
	defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
	inst._zod.parse = (payload, ctx) => {
		if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
		const result = def.innerType._zod.run({
			value: payload.value,
			issues: []
		}, ctx);
		if (result instanceof Promise) return result.then((result) => handleCatchResult(payload, result, def, ctx));
		return handleCatchResult(payload, result, def, ctx);
	};
});
const $ZodPipe = /*@__PURE__*/ $constructor("$ZodPipe", (inst, def) => {
	$ZodType.init(inst, def);
	defineLazyInternal(inst, "values", (zod) => zod.def.in._zod.values);
	defineLazyInternal(inst, "optin", (zod) => zod.def.in._zod.optin);
	defineLazyInternal(inst, "optout", (zod) => zod.def.out._zod.optout);
	defineLazyInternal(inst, "propValues", (zod) => zod.def.in._zod.propValues);
	inst._zod.parse = (payload, ctx) => {
		if (ctx.direction === "backward") {
			const right = def.out._zod.run(payload, ctx);
			if (right instanceof Promise) return right.then((right) => handlePipeResult(right, def.in, ctx));
			return handlePipeResult(right, def.in, ctx);
		}
		const left = def.in._zod.run(payload, ctx);
		if (left instanceof Promise) return left.then((left) => handlePipeResult(left, def.out, ctx));
		return handlePipeResult(left, def.out, ctx);
	};
});
function handlePipeResult(left, next, ctx) {
	if (left.issues.some((iss) => iss.code !== "unrecognized_keys")) {
		left.aborted = true;
		return left;
	}
	return next._zod.run({
		value: left.value,
		issues: left.issues
	}, ctx);
}
const $ZodReadonly = /*@__PURE__*/ $constructor("$ZodReadonly", (inst, def) => {
	$ZodType.init(inst, def);
	defineLazyInternal(inst, "propValues", (zod) => zod.def.innerType._zod.propValues);
	defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
	defineLazyInternal(inst, "optin", (zod) => zod.def.innerType?._zod?.optin);
	defineLazyInternal(inst, "optout", (zod) => zod.def.innerType?._zod?.optout);
	inst._zod.parse = (payload, ctx) => {
		if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
		const result = def.innerType._zod.run(payload, ctx);
		if (result instanceof Promise) return result.then(handleReadonlyResult);
		return handleReadonlyResult(result);
	};
});
function handleReadonlyResult(payload) {
	if (!payload.memo) payload.value = Object.freeze(payload.value);
	return payload;
}
const $ZodCustom = /*@__PURE__*/ $constructor("$ZodCustom", (inst, def) => {
	$ZodCheck.init(inst, def);
	$ZodType.init(inst, def);
	inst._zod.parse = (payload, _) => {
		return payload;
	};
	inst._zod.check = (payload) => {
		const input = payload.value;
		const r = def.fn(input);
		if (r instanceof Promise) return r.then((r) => handleRefineResult(r, payload, input, inst));
		handleRefineResult(r, payload, input, inst);
	};
});
function handleRefineResult(result, payload, input, inst) {
	if (!result) {
		const _iss = {
			code: "custom",
			input,
			inst,
			path: [...inst._zod.def.path ?? []],
			continue: !inst._zod.def.abort
		};
		if (inst._zod.def.params) _iss.params = inst._zod.def.params;
		payload.issues.push(issue(_iss));
	}
}
//#endregion
//#region ../../node_modules/.pnpm/zod@4.6.7/node_modules/zod/v4/core/memoizer.js
var $ZodCyclicError = class extends Error {
	constructor() {
		super(`Cannot parse a reference cycle that closes through a transform`);
		this.name = "ZodCyclicError";
	}
};
/** Keyed off the context object every schema in one parse call already shares. */
const STATE = "~memo";
const NO_ISSUES = [];
function isRef(value) {
	return value !== null && typeof value === "object";
}
function cloneIssues(issues) {
	return issues.map((iss) => iss.path ? {
		...iss,
		path: iss.path.slice()
	} : { ...iss });
}
const recursive = /*@__PURE__*/ new WeakMap();
/** What the walk established, in order of certainty: ordered so the strongest answer among children wins. */
const NONE = 0;
const ASSUMED = 1;
const PROVEN = 2;
/** Whether this schema's subtree contains a cycle, so one parse can re-enter it. */
function isRecursive(inst, stack, resolve) {
	const cached = recursive.get(inst);
	if (cached !== void 0) return cached ? PROVEN : NONE;
	if (stack.has(inst)) return PROVEN;
	stack.add(inst);
	let result = NONE;
	const check = (child) => {
		if (result !== PROVEN && child?._zod) {
			const answer = isRecursive(child, stack, resolve);
			if (answer > result) result = answer;
		}
	};
	const shape = (sh, spread) => {
		let answer = NONE;
		for (const key of Reflect.ownKeys(sh)) {
			const desc = Object.getOwnPropertyDescriptor(sh, key);
			if (spread && !desc.enumerable) continue;
			const child = desc.get ? ASSUMED : desc.value?._zod ? isRecursive(desc.value, stack, resolve) : NONE;
			if (child > answer) answer = child;
		}
		return answer;
	};
	const merge = (answer) => {
		if (answer > result) result = answer;
	};
	const def = inst._zod.def;
	switch (def.type) {
		case "object": {
			const raw = rawShape(def);
			merge(raw ? shape(raw, true) : ASSUMED);
			check(def.catchall);
			break;
		}
		case "array":
			check(def.element);
			break;
		case "tuple":
			for (const el of def.items) check(el);
			check(def.rest);
			break;
		case "record":
		case "map":
			check(def.keyType);
			check(def.valueType);
			break;
		case "set":
			check(def.valueType);
			break;
		case "union":
			for (const el of def.options) check(el);
			break;
		case "intersection":
			check(def.left);
			check(def.right);
			break;
		case "optional":
		case "nullable":
		case "default":
		case "prefault":
		case "catch":
		case "readonly":
		case "nonoptional":
		case "promise":
		case "success":
			check(def.innerType);
			break;
		case "pipe":
			check(def.in);
			check(def.out);
			break;
		case "function":
			check(def.input);
			check(def.output);
			break;
		case "lazy": {
			const inner = def._cachedInner ?? (resolve ? inst._zod.innerType : void 0);
			merge(inner ? isRecursive(inner, stack, false) : ASSUMED);
			break;
		}
		case "template_literal":
		case "string":
		case "number":
		case "int":
		case "boolean":
		case "bigint":
		case "symbol":
		case "undefined":
		case "null":
		case "void":
		case "never":
		case "any":
		case "unknown":
		case "date":
		case "nan":
		case "enum":
		case "literal":
		case "file":
		case "transform":
		case "custom": break;
		default: for (const key in def) {
			const desc = Object.getOwnPropertyDescriptor(def, key);
			if (!desc || desc.get) continue;
			const value = desc.value;
			if (!value || typeof value !== "object") continue;
			if (value._zod) check(value);
			else if (Array.isArray(value)) for (const el of value) check(el);
		}
	}
	stack.delete(inst);
	return settle(inst, result);
}
/** An assumed answer must not outlive the resolution that settles it, so only a certain one is cached. */
function settle(inst, answer) {
	if (answer !== ASSUMED) recursive.set(inst, answer === PROVEN);
	return answer;
}
function bucketFor(state, inst) {
	let bucket = state.buckets.get(inst);
	if (!bucket) {
		bucket = /* @__PURE__ */ new WeakMap();
		state.buckets.set(inst, bucket);
	}
	return bucket;
}
let handoff;
const open = [];
const memo = {
	alloc(_inst, payload, empty) {
		const bucket = handoff;
		if (!bucket) return empty;
		handoff = void 0;
		const entry = {
			value: empty,
			issues: null
		};
		bucket.set(payload.value, entry);
		open.push(entry);
		return empty;
	},
	guard(inst) {
		var _a;
		(_a = inst._zod).deferred ?? (_a.deferred = []);
		inst._zod.deferred.push(() => {
			const base = inst._zod.parse;
			const wrapped = (payload, ctx) => {
				if (ctx.direction !== "backward" && isBackEdge(ctx, payload.value)) throw new $ZodCyclicError();
				return base(payload, ctx);
			};
			inst._zod.parse = wrapped;
			if (inst._zod.run === base) inst._zod.run = wrapped;
		});
	},
	attach(inst) {
		var _a;
		let isRecursiveInst;
		let rechecked = false;
		let lastCtx;
		let lastBucket;
		(_a = inst._zod).deferred ?? (_a.deferred = []);
		inst._zod.deferred.push(() => {
			const base = inst._zod.parse;
			const wrapped = (payload, ctx) => {
				if (isRecursiveInst === void 0) {
					const walked = isRecursive(inst, /* @__PURE__ */ new Set(), false);
					if (walked === NONE) {
						inst._zod.parse = base;
						if (inst._zod.run === wrapped) inst._zod.run = base;
						return base(payload, ctx);
					}
					if (walked === PROVEN || rechecked) isRecursiveInst = true;
					else rechecked = true;
				}
				const input = payload.value;
				if (!isRef(input)) return base(payload, ctx);
				let state = ctx[STATE];
				if (!state) {
					state = {
						buckets: /* @__PURE__ */ new WeakMap(),
						backEdges: void 0
					};
					ctx[STATE] = state;
				}
				let bucket;
				if (lastCtx === ctx) bucket = lastBucket;
				else {
					bucket = bucketFor(state, inst);
					lastCtx = ctx;
					lastBucket = bucket;
				}
				const hit = bucket.get(input);
				if (hit) {
					payload.value = hit.value;
					if (hit.issues) {
						if (hit.issues.length) payload.issues.push(...cloneIssues(hit.issues));
					} else {
						payload.memo = true;
						state.backEdges ?? (state.backEdges = /* @__PURE__ */ new WeakSet());
						state.backEdges.add(hit.value);
					}
					return payload;
				}
				handoff = bucket;
				const depth = open.length;
				const result = base(payload, ctx);
				handoff = void 0;
				const entry = open.length > depth ? open.pop() : void 0;
				if (result instanceof Promise) return result.then((r) => {
					if (entry) entry.issues = r.issues.length ? cloneIssues(r.issues) : NO_ISSUES;
					return r;
				});
				if (entry) entry.issues = result.issues.length ? cloneIssues(result.issues) : NO_ISSUES;
				return result;
			};
			inst._zod.parse = wrapped;
			if (inst._zod.run === base) inst._zod.run = wrapped;
		});
	}
};
/** The memoizer that gives containers cycle support. `zod` installs it by default; `zod/mini` opts in with `config({ memoizer: memoizer() })`. */
function memoizer() {
	return memo;
}
/** Whether this value is a node a back-edge resolved to before it finished. */
function isBackEdge(ctx, value) {
	const backEdges = ctx[STATE]?.backEdges;
	return backEdges !== void 0 && isRef(value) && backEdges.has(value);
}
//#endregion
//#region ../../node_modules/.pnpm/zod@4.6.7/node_modules/zod/v4/locales/en.js
const error = () => {
	const Sizable = {
		string: {
			unit: "characters",
			verb: "to have"
		},
		file: {
			unit: "bytes",
			verb: "to have"
		},
		array: {
			unit: "items",
			verb: "to have"
		},
		set: {
			unit: "items",
			verb: "to have"
		},
		map: {
			unit: "entries",
			verb: "to have"
		}
	};
	function getSizing(origin) {
		return Sizable[origin] ?? null;
	}
	const FormatDictionary = {
		regex: "input",
		email: "email address",
		url: "URL",
		emoji: "emoji",
		uuid: "UUID",
		uuidv4: "UUIDv4",
		uuidv6: "UUIDv6",
		nanoid: "nanoid",
		guid: "GUID",
		cuid: "cuid",
		cuid2: "cuid2",
		ulid: "ULID",
		xid: "XID",
		ksuid: "KSUID",
		datetime: "ISO datetime",
		date: "ISO date",
		time: "ISO time",
		duration: "ISO duration",
		ipv4: "IPv4 address",
		ipv6: "IPv6 address",
		mac: "MAC address",
		cidrv4: "IPv4 range",
		cidrv6: "IPv6 range",
		base64: "base64-encoded string",
		base64url: "base64url-encoded string",
		json_string: "JSON string",
		e164: "E.164 number",
		currency_code: "currency code",
		credit_card: "credit card number",
		iban: "IBAN",
		jwt: "JWT",
		template_literal: "input"
	};
	const TypeDictionary = { nan: "NaN" };
	function getTypeName(type, input) {
		if (type === "number" && typeof input === "number" && !Number.isFinite(input)) return String(input);
		return TypeDictionary[type] ?? type;
	}
	return (issue) => {
		switch (issue.code) {
			case "invalid_type": return `Invalid input: expected ${getTypeName(issue.expected)}, received ${getTypeName(parsedType(issue.input), issue.input)}`;
			case "invalid_value":
				if (issue.values.length === 1) return `Invalid input: expected ${stringifyPrimitive(issue.values[0])}`;
				return `Invalid option: expected one of ${joinValues(issue.values, "|")}`;
			case "too_big": {
				const adj = issue.exact ? "exactly " : issue.inclusive ? "<=" : "<";
				const sizing = getSizing(issue.origin);
				if (sizing) return `Too big: expected ${issue.origin ?? "value"} to have ${adj}${issue.maximum.toString()} ${sizing.unit ?? "elements"}`;
				return `Too big: expected ${issue.origin ?? "value"} to be ${adj}${issue.maximum.toString()}`;
			}
			case "too_small": {
				const adj = issue.exact ? "exactly " : issue.inclusive ? ">=" : ">";
				const sizing = getSizing(issue.origin);
				if (sizing) return `Too small: expected ${issue.origin} to have ${adj}${issue.minimum.toString()} ${sizing.unit}`;
				return `Too small: expected ${issue.origin} to be ${adj}${issue.minimum.toString()}`;
			}
			case "invalid_format": {
				const _issue = issue;
				if (_issue.format === "starts_with") return `Invalid string: must start with "${_issue.prefix}"`;
				if (_issue.format === "ends_with") return `Invalid string: must end with "${_issue.suffix}"`;
				if (_issue.format === "includes") return `Invalid string: must include "${_issue.includes}"`;
				if (_issue.format === "regex") return `Invalid string: must match pattern ${_issue.pattern}`;
				return `Invalid ${FormatDictionary[_issue.format] ?? issue.format}`;
			}
			case "not_multiple_of": return `Invalid number: must be a multiple of ${issue.divisor}`;
			case "unrecognized_keys": return `Unrecognized key${issue.keys.length > 1 ? "s" : ""}: ${joinValues(issue.keys, ", ")}`;
			case "invalid_key": return `Invalid key in ${issue.origin}`;
			case "invalid_union":
				if (issue.options && Array.isArray(issue.options) && issue.options.length > 0) return `Invalid discriminator value. Expected ${issue.options.map((o) => `'${o}'`).join(" | ")}`;
				if (issue.inclusive === false) return "Invalid input: more than one option matched";
				return "Invalid input";
			case "invalid_element": return `Invalid value in ${issue.origin}`;
			default: return `Invalid input`;
		}
	};
};
function en_default() {
	return { localeError: error() };
}
//#endregion
//#region ../../node_modules/.pnpm/zod@4.6.7/node_modules/zod/v4/core/registries.js
var _a;
var $ZodRegistry = class {
	constructor() {
		this._map = /* @__PURE__ */ new WeakMap();
		this._idmap = /* @__PURE__ */ new Map();
	}
	add(schema, ..._meta) {
		const meta = _meta[0];
		this._map.set(schema, meta);
		if (meta && typeof meta === "object" && "id" in meta) this._idmap.set(meta.id, schema);
		return this;
	}
	clear() {
		this._map = /* @__PURE__ */ new WeakMap();
		this._idmap = /* @__PURE__ */ new Map();
		return this;
	}
	remove(schema) {
		const meta = this._map.get(schema);
		if (meta && typeof meta === "object" && "id" in meta) this._idmap.delete(meta.id);
		this._map.delete(schema);
		return this;
	}
	get(schema) {
		const p = schema._zod.parent;
		if (p) {
			const pm = { ...this.get(p) ?? {} };
			delete pm.id;
			const f = {
				...pm,
				...this._map.get(schema)
			};
			return Object.keys(f).length ? f : void 0;
		}
		return this._map.get(schema);
	}
	has(schema) {
		return this._map.has(schema);
	}
};
function registry() {
	return new $ZodRegistry();
}
(_a = globalThis).__zod_globalRegistry ?? (_a.__zod_globalRegistry = registry());
const globalRegistry = globalThis.__zod_globalRegistry;
//#endregion
//#region ../../node_modules/.pnpm/zod@4.6.7/node_modules/zod/v4/core/api.js
function snapshotChecks(def) {
	if (def.checks) def.checks = [...def.checks];
	return def;
}
// @__NO_SIDE_EFFECTS__
function _string(Class, params) {
	return new Class(snapshotChecks({
		type: "string",
		...normalizeParams(params)
	}));
}
// @__NO_SIDE_EFFECTS__
function _email(Class, params) {
	return new Class({
		type: "string",
		format: "email",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _guid(Class, params) {
	return new Class({
		type: "string",
		format: "guid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _uuid(Class, params) {
	return new Class({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _uuidv4(Class, params) {
	return new Class({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: false,
		version: "v4",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _uuidv6(Class, params) {
	return new Class({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: false,
		version: "v6",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _uuidv7(Class, params) {
	return new Class({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: false,
		version: "v7",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _url(Class, params) {
	return new Class({
		type: "string",
		format: "url",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _emoji(Class, params) {
	return new Class({
		type: "string",
		format: "emoji",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _nanoid(Class, params) {
	return new Class({
		type: "string",
		format: "nanoid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
/**
* @deprecated CUID v1 is deprecated by its authors due to information leakage
* (timestamps embedded in the id). Use {@link _cuid2} instead.
* See https://github.com/paralleldrive/cuid.
*/
// @__NO_SIDE_EFFECTS__
function _cuid(Class, params) {
	return new Class({
		type: "string",
		format: "cuid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _cuid2(Class, params) {
	return new Class({
		type: "string",
		format: "cuid2",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _ulid(Class, params) {
	return new Class({
		type: "string",
		format: "ulid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _xid(Class, params) {
	return new Class({
		type: "string",
		format: "xid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _ksuid(Class, params) {
	return new Class({
		type: "string",
		format: "ksuid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _ipv4(Class, params) {
	return new Class({
		type: "string",
		format: "ipv4",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _ipv6(Class, params) {
	return new Class({
		type: "string",
		format: "ipv6",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _cidrv4(Class, params) {
	return new Class({
		type: "string",
		format: "cidrv4",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _cidrv6(Class, params) {
	return new Class({
		type: "string",
		format: "cidrv6",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _base64(Class, params) {
	return new Class({
		type: "string",
		format: "base64",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _base64url(Class, params) {
	return new Class({
		type: "string",
		format: "base64url",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _e164(Class, params) {
	return new Class({
		type: "string",
		format: "e164",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _jwt(Class, params) {
	return new Class({
		type: "string",
		format: "jwt",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _isoDateTime(Class, params) {
	return new Class({
		type: "string",
		format: "datetime",
		check: "string_format",
		offset: false,
		local: false,
		precision: null,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _isoDate(Class, params) {
	return new Class({
		type: "string",
		format: "date",
		check: "string_format",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _isoTime(Class, params) {
	return new Class({
		type: "string",
		format: "time",
		check: "string_format",
		precision: null,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _isoDuration(Class, params) {
	return new Class({
		type: "string",
		format: "duration",
		check: "string_format",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _number(Class, params) {
	return new Class(snapshotChecks({
		type: "number",
		checks: [],
		...normalizeParams(params)
	}));
}
// @__NO_SIDE_EFFECTS__
function _int(Class, params) {
	return new Class({
		type: "number",
		check: "number_format",
		abort: false,
		format: "safeint",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _boolean(Class, params) {
	return new Class({
		type: "boolean",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _unknown(Class) {
	return new Class({ type: "unknown" });
}
// @__NO_SIDE_EFFECTS__
function _never(Class, params) {
	return new Class({
		type: "never",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _lt(value, params) {
	return new $ZodCheckLessThan({
		check: "less_than",
		...normalizeParams(params),
		value,
		inclusive: false
	});
}
// @__NO_SIDE_EFFECTS__
function _lte(value, params) {
	return new $ZodCheckLessThan({
		check: "less_than",
		...normalizeParams(params),
		value,
		inclusive: true
	});
}
// @__NO_SIDE_EFFECTS__
function _gt(value, params) {
	return new $ZodCheckGreaterThan({
		check: "greater_than",
		...normalizeParams(params),
		value,
		inclusive: false
	});
}
// @__NO_SIDE_EFFECTS__
function _gte(value, params) {
	return new $ZodCheckGreaterThan({
		check: "greater_than",
		...normalizeParams(params),
		value,
		inclusive: true
	});
}
// @__NO_SIDE_EFFECTS__
function _multipleOf(value, params) {
	return new $ZodCheckMultipleOf({
		check: "multiple_of",
		...normalizeParams(params),
		value
	});
}
// @__NO_SIDE_EFFECTS__
function _maxLength(maximum, params) {
	return new $ZodCheckMaxLength({
		check: "max_length",
		...normalizeParams(params),
		maximum
	});
}
// @__NO_SIDE_EFFECTS__
function _minLength(minimum, params) {
	return new $ZodCheckMinLength({
		check: "min_length",
		...normalizeParams(params),
		minimum
	});
}
// @__NO_SIDE_EFFECTS__
function _length(length, params) {
	return new $ZodCheckLengthEquals({
		check: "length_equals",
		...normalizeParams(params),
		length
	});
}
// @__NO_SIDE_EFFECTS__
function _regex(pattern, params) {
	return new $ZodCheckRegex({
		check: "string_format",
		format: "regex",
		...normalizeParams(params),
		pattern
	});
}
// @__NO_SIDE_EFFECTS__
function _lowercase(params) {
	return new $ZodCheckLowerCase({
		check: "string_format",
		format: "lowercase",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _uppercase(params) {
	return new $ZodCheckUpperCase({
		check: "string_format",
		format: "uppercase",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _includes(includes, params) {
	return new $ZodCheckIncludes({
		check: "string_format",
		format: "includes",
		...normalizeParams(params),
		includes
	});
}
// @__NO_SIDE_EFFECTS__
function _startsWith(prefix, params) {
	return new $ZodCheckStartsWith({
		check: "string_format",
		format: "starts_with",
		...normalizeParams(params),
		prefix
	});
}
// @__NO_SIDE_EFFECTS__
function _endsWith(suffix, params) {
	return new $ZodCheckEndsWith({
		check: "string_format",
		format: "ends_with",
		...normalizeParams(params),
		suffix
	});
}
// @__NO_SIDE_EFFECTS__
function _overwrite(tx) {
	return new $ZodCheckOverwrite({
		check: "overwrite",
		tx
	});
}
// @__NO_SIDE_EFFECTS__
function _normalize(form) {
	return /* @__PURE__ */ _overwrite((input) => input.normalize(form));
}
// @__NO_SIDE_EFFECTS__
function _trim() {
	return /* @__PURE__ */ _overwrite((input) => input.trim());
}
// @__NO_SIDE_EFFECTS__
function _toLowerCase() {
	return /* @__PURE__ */ _overwrite((input) => input.toLowerCase());
}
// @__NO_SIDE_EFFECTS__
function _toUpperCase() {
	return /* @__PURE__ */ _overwrite((input) => input.toUpperCase());
}
// @__NO_SIDE_EFFECTS__
function _slugify() {
	return /* @__PURE__ */ _overwrite((input) => slugify(input));
}
// @__NO_SIDE_EFFECTS__
function _array(Class, element, params) {
	return new Class({
		type: "array",
		element,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _refine(Class, fn, _params) {
	return new Class({
		type: "custom",
		check: "custom",
		fn,
		...normalizeParams(_params)
	});
}
// @__NO_SIDE_EFFECTS__
function _superRefine(fn, params) {
	const ch = /* @__PURE__ */ _check((payload) => {
		payload.addIssue = (issue$2) => {
			if (typeof issue$2 === "string") payload.issues.push(issue(issue$2, payload.value, ch._zod.def));
			else {
				const _issue = issue$2;
				if (_issue.fatal) _issue.continue = false;
				_issue.code ?? (_issue.code = "custom");
				if (!("input" in _issue)) _issue.input = payload.value;
				_issue.inst ?? (_issue.inst = ch);
				_issue.continue ?? (_issue.continue = !ch._zod.def.abort);
				payload.issues.push(issue(_issue));
			}
		};
		return fn(payload.value, payload);
	}, params);
	return ch;
}
// @__NO_SIDE_EFFECTS__
function _check(fn, params) {
	const ch = new $ZodCheck({
		check: "custom",
		...normalizeParams(params)
	});
	ch._zod.check = fn;
	return ch;
}
//#endregion
//#region ../../node_modules/.pnpm/zod@4.6.7/node_modules/zod/v4/core/to-json-schema.js
function assignProps(target, ...sources) {
	for (const source of sources) for (const key of Reflect.ownKeys(source)) if (Object.prototype.propertyIsEnumerable.call(source, key)) assignProp(target, key, source[key]);
	return target;
}
function initializeContext(params) {
	let target = params?.target ?? "draft-2020-12";
	if (target === "draft-4") target = "draft-04";
	if (target === "draft-7") target = "draft-07";
	return {
		processors: params.processors ?? {},
		metadataRegistry: params?.metadata ?? globalRegistry,
		target,
		unrepresentable: params?.unrepresentable ?? "throw",
		override: params?.override ?? (() => {}),
		io: params?.io ?? "output",
		counter: 0,
		seen: /* @__PURE__ */ new Map(),
		sharedDefsExtractedFor: void 0,
		sharedEmitDoneFor: void 0,
		cycles: params?.cycles ?? "ref",
		reused: params?.reused ?? "inline",
		intersections: [],
		deferred: [],
		external: params?.external ?? void 0
	};
}
/**
* Applies the `unrepresentable` setting at a site that has no JSON Schema equivalent. Throws
* `message` unless the setting (or the handler's return value) says otherwise. Returns `true` if a
* custom JSON Schema was written into `json`, in which case the caller must not write its own.
*/
function handleUnrepresentable(schema, ctx, json, params, message) {
	const result = typeof ctx.unrepresentable === "function" ? ctx.unrepresentable({
		zodSchema: schema,
		path: params.path,
		message
	}) : ctx.unrepresentable;
	if (result === "any") return false;
	if (result === void 0 || result === "throw") throw new Error(message);
	Object.assign(json, result);
	return true;
}
function processSchema(schema, ctx, _params = {
	path: [],
	schemaPath: []
}) {
	var _a;
	const def = schema._zod.def;
	const seen = ctx.seen.get(schema);
	if (seen) {
		seen.count++;
		if (_params.schemaPath.includes(schema)) seen.cycle = _params.path;
		return seen.schema;
	}
	const result = {
		schema: {},
		count: 1,
		cycle: void 0,
		path: _params.path
	};
	ctx.seen.set(schema, result);
	ctx.sharedDefsExtractedFor = void 0;
	ctx.sharedEmitDoneFor = void 0;
	const overrideSchema = schema._zod.toJSONSchema?.();
	if (overrideSchema) result.schema = overrideSchema;
	else {
		const params = {
			..._params,
			schemaPath: [..._params.schemaPath, schema],
			path: _params.path
		};
		if (schema._zod.processJSONSchema) schema._zod.processJSONSchema(ctx, result.schema, params);
		else {
			const _json = result.schema;
			const processor = ctx.processors[def.type];
			if (!processor) throw new Error(`[toJSONSchema]: Non-representable type encountered: ${def.type}`);
			processor(schema, ctx, _json, params);
		}
		const parent = schema._zod.parent;
		if (parent) {
			if (!result.ref) result.ref = parent;
			processSchema(parent, ctx, params);
			ctx.seen.get(parent).isParent = true;
		}
	}
	const meta = ctx.metadataRegistry.get(schema);
	if (meta) assignProps(result.schema, meta);
	if (ctx.io === "input" && isTransforming(schema)) {
		delete result.schema.examples;
		delete result.schema.default;
	}
	if (ctx.io === "input" && "_prefault" in result.schema) (_a = result.schema).default ?? (_a.default = result.schema._prefault);
	delete result.schema._prefault;
	return ctx.seen.get(schema).schema;
}
function encodeJSONPointerSegment(segment) {
	return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}
function extractDefs(ctx, schema) {
	const root = ctx.seen.get(schema);
	if (!root) throw new Error("Unprocessed schema. This is a bug in Zod.");
	if (ctx.external && ctx.sharedDefsExtractedFor === ctx.external) return;
	const idToSchema = /* @__PURE__ */ new Map();
	for (const entry of ctx.seen.entries()) {
		const id = ctx.metadataRegistry.get(entry[0])?.id;
		if (id) {
			const existing = idToSchema.get(id);
			if (existing && existing !== entry[0]) throw new Error(`Duplicate schema id "${id}" detected during JSON Schema conversion. Two different schemas cannot share the same id when converted together.`);
			idToSchema.set(id, entry[0]);
		}
	}
	const makeURI = (entry) => {
		const defsSegment = ctx.target === "draft-2020-12" ? "$defs" : "definitions";
		if (ctx.external) {
			const externalId = ctx.external.registry.get(entry[0])?.id;
			const uriGenerator = ctx.external.uri ?? ((id) => id);
			if (externalId) return { ref: uriGenerator(externalId) };
			const id = entry[1].defId ?? entry[1].schema.id ?? `schema${ctx.counter++}`;
			entry[1].defId = id;
			return {
				defId: id,
				ref: `${uriGenerator("__shared")}#/${defsSegment}/${encodeJSONPointerSegment(id)}`
			};
		}
		const uriPrefix = `#`;
		const defUriPrefix = `${uriPrefix}/${defsSegment}/`;
		if (entry[1] === root && !entry[1].schema.id) return { ref: uriPrefix };
		const defId = entry[1].schema.id ?? `__schema${ctx.counter++}`;
		return {
			defId,
			ref: defUriPrefix + encodeJSONPointerSegment(defId)
		};
	};
	const extractToDef = (entry) => {
		if (entry[1].schema.$ref) return;
		const seen = entry[1];
		const { ref, defId } = makeURI(entry);
		seen.def = { ...seen.schema };
		if (defId) seen.defId = defId;
		const schema = seen.schema;
		for (const key in schema) delete schema[key];
		schema.$ref = ref;
	};
	if (ctx.cycles === "throw") for (const entry of ctx.seen.entries()) {
		const seen = entry[1];
		if (seen.cycle) throw new Error(`Cycle detected: #/${seen.cycle?.join("/")}/<root>

Set the \`cycles\` parameter to \`"ref"\` to resolve cyclical schemas with defs.`);
	}
	for (const entry of ctx.seen.entries()) {
		const seen = entry[1];
		if (schema === entry[0]) {
			extractToDef(entry);
			continue;
		}
		if (ctx.external) {
			const ext = ctx.external.registry.get(entry[0])?.id;
			if (schema !== entry[0] && ext) {
				extractToDef(entry);
				continue;
			}
		}
		if (ctx.metadataRegistry.get(entry[0])?.id) {
			extractToDef(entry);
			continue;
		}
		if (seen.cycle) {
			extractToDef(entry);
			continue;
		}
		if (seen.count > 1) {
			if (ctx.reused === "ref") extractToDef(entry);
		}
	}
	if (ctx.external) ctx.sharedDefsExtractedFor = ctx.external;
}
/** Rewrites `anyOf: [{type: "a"}, {type: "b"}]` to `type: ["a", "b"]`, which every JSON Schema draft treats as equivalent and most consumers render far better for the nullable case. Only branches that are a bare type assertion qualify — anything carrying a constraint, `$ref`, `const` or metadata is left alone. Runs after `flattenRef`, so a branch an override decorated or `$defs` extraction turned into a `$ref` is no longer bare and correctly stays in `anyOf`. `oneOf` is excluded: `integer` and `number` overlap, so "exactly one" and "at least one" are not the same there. OpenAPI 3.0 is excluded: its `type` must be a single string. */
function compactTypeUnion(schema) {
	const options = schema.anyOf;
	if (!Array.isArray(options) || options.length === 0 || schema.type !== void 0) return;
	const types = [];
	for (const option of options) {
		if (!option || typeof option !== "object") return;
		compactTypeUnion(option);
		const keys = Object.keys(option);
		if (keys.length !== 1 || keys[0] !== "type") return;
		const type = option.type;
		for (const member of Array.isArray(type) ? type : [type]) {
			if (typeof member !== "string") return;
			if (!types.includes(member)) types.push(member);
		}
	}
	delete schema.anyOf;
	schema.type = types.length === 1 ? types[0] : types;
}
/** Keywords `foldIntersection` knows how to combine. Anything else — `$ref`, `patternProperties`,
* an annotation like `description` — makes a member unfoldable, so a constraint this does not
* understand leaves the `allOf` alone instead of being silently dropped or misattributed. */
const FOLDABLE_KEYS = /* @__PURE__ */ new Set([
	"type",
	"properties",
	"required",
	"additionalProperties"
]);
const UNION_KEYS = ["oneOf", "anyOf"];
/** A member's constraint on a key it does not declare itself. A `catchall` states one; `false`, an absent `additionalProperties`, and the empty schema a loose object emits state nothing. */
function undeclaredConstraint(member) {
	const extra = member.additionalProperties;
	if (extra === void 0 || extra === false || typeof extra !== "object" || extra === null) return null;
	return Object.keys(extra).length ? extra : null;
}
/** Combines object members into the single object they describe together, or returns `null` if any of them carries a keyword outside {@link FOLDABLE_KEYS}. */
function foldObjects(members) {
	const objects = [];
	for (const member of members) {
		if (typeof member !== "object" || member.type !== "object") return null;
		for (const key in member) if (!FOLDABLE_KEYS.has(key)) return null;
		objects.push(member);
	}
	const properties = {};
	const required = /* @__PURE__ */ new Set();
	for (const object of objects) {
		for (const key in object.properties) {
			if (Object.prototype.hasOwnProperty.call(properties, key)) continue;
			const parts = [];
			for (const other of objects) {
				const part = other.properties?.[key] ?? undeclaredConstraint(other);
				if (part === null || part === void 0) continue;
				if (!parts.some((seen) => JSON.stringify(seen) === JSON.stringify(part))) parts.push(part);
			}
			assignProp(properties, key, parts.length === 1 ? parts[0] : foldObjects(parts) ?? { allOf: parts });
		}
		for (const key of object.required ?? []) required.add(key);
	}
	const folded = {
		type: "object",
		properties
	};
	if (required.size) folded.required = [...required];
	if (objects.every((object) => object.additionalProperties === false)) folded.additionalProperties = false;
	else {
		const constraints = [];
		for (const object of objects) {
			const constraint = undeclaredConstraint(object);
			if (constraint && !constraints.some((seen) => JSON.stringify(seen) === JSON.stringify(constraint))) constraints.push(constraint);
		}
		if (constraints.length === 1) folded.additionalProperties = constraints[0];
		else if (constraints.length > 1) folded.additionalProperties = { allOf: constraints };
	}
	return folded;
}
/** `additionalProperties` in an `allOf` member sees only that member's own `properties`, so two
* closed object members reject each other's keys and the schema validates nothing. Zod's parser
* pools the key sets instead — `handleIntersectionResults` reports a key as unrecognized only when
* *every* side rejects it — so the emitted schema has to pool them too, and folding the members
* into one object is the encoding that says so on every target.
*
* This runs from `finalize`, after `extractDefs`, which is what keeps it clear of the `$ref`
* machinery: a member extracted into `$defs` is already a `$ref` by now and declines to fold, so it
* keeps its reference and its own closedness rather than being inlined as a stale copy. */
function foldIntersection(json) {
	const allOf = json.allOf;
	if (!Array.isArray(allOf) || allOf.length < 2) return;
	for (const key of FOLDABLE_KEYS) if (key in json) return;
	const unions = allOf.filter((m) => UNION_KEYS.some((k) => Array.isArray(m[k])));
	let folded = null;
	if (!unions.length) folded = foldObjects(allOf);
	else {
		const union = unions[0];
		const keyword = UNION_KEYS.find((k) => Array.isArray(union[k]));
		if (Object.keys(union).length !== 1) return;
		const rest = allOf.filter((m) => m !== union);
		const branches = union[keyword].map((branch) => foldObjects([...rest, branch]));
		if (branches.some((b) => !b)) return;
		folded = { [keyword]: branches };
	}
	if (!folded) return;
	delete json.allOf;
	assignProps(json, folded);
}
function finalize(ctx, schema) {
	const root = ctx.seen.get(schema);
	if (!root) throw new Error("Unprocessed schema. This is a bug in Zod.");
	const flattenRef = (zodSchema) => {
		const seen = ctx.seen.get(zodSchema);
		if (seen.ref === null) return;
		const schema = seen.def ?? seen.schema;
		const _cached = { ...schema };
		const ref = seen.ref;
		seen.ref = null;
		if (ref) {
			flattenRef(ref);
			const refSeen = ctx.seen.get(ref);
			const refSchema = refSeen.schema;
			if (refSchema.$ref && (ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0")) {
				schema.allOf = schema.allOf ?? [];
				schema.allOf.push(refSchema);
			} else assignProps(schema, refSchema);
			assignProps(schema, _cached);
			if (zodSchema._zod.parent === ref) for (const key in schema) {
				if (key === "$ref" || key === "allOf") continue;
				if (!(key in _cached)) delete schema[key];
			}
			if (refSchema.$ref && refSeen.def) for (const key in schema) {
				if (key === "$ref" || key === "allOf") continue;
				if (key in refSeen.def && JSON.stringify(schema[key]) === JSON.stringify(refSeen.def[key])) delete schema[key];
			}
		}
		const parent = zodSchema._zod.parent;
		if (parent && parent !== ref) {
			flattenRef(parent);
			const parentSeen = ctx.seen.get(parent);
			if (parentSeen?.schema.$ref) {
				schema.$ref = parentSeen.schema.$ref;
				if (parentSeen.def) for (const key in schema) {
					if (key === "$ref" || key === "allOf") continue;
					if (key in parentSeen.def && JSON.stringify(schema[key]) === JSON.stringify(parentSeen.def[key])) delete schema[key];
				}
			}
		}
		ctx.override({
			zodSchema,
			jsonSchema: schema,
			path: seen.path ?? []
		});
	};
	if (!ctx.external || ctx.sharedEmitDoneFor !== ctx.external) {
		for (const entry of [...ctx.seen.entries()].reverse()) flattenRef(entry[0]);
		if (ctx.target !== "openapi-3.0") for (const entry of ctx.seen.entries()) compactTypeUnion(entry[1].def ?? entry[1].schema);
		for (const rewrite of ctx.deferred) rewrite();
		if (ctx.intersections.length) {
			const carriers = /* @__PURE__ */ new Map();
			for (const seen of ctx.seen.values()) for (const json of [seen.schema, seen.def]) {
				const allOf = json?.allOf;
				if (!Array.isArray(allOf)) continue;
				const existing = carriers.get(allOf);
				if (existing) existing.push(json);
				else carriers.set(allOf, [json]);
			}
			for (const allOf of ctx.intersections) for (const json of carriers.get(allOf) ?? []) foldIntersection(json);
		}
	}
	const result = {};
	if (ctx.target === "draft-2020-12") result.$schema = "https://json-schema.org/draft/2020-12/schema";
	else if (ctx.target === "draft-07") result.$schema = "http://json-schema.org/draft-07/schema#";
	else if (ctx.target === "draft-04") result.$schema = "http://json-schema.org/draft-04/schema#";
	else if (ctx.target === "openapi-3.0") {}
	if (ctx.external?.uri) {
		const id = ctx.external.registry.get(schema)?.id;
		if (!id) throw new Error("Schema is missing an `id` property");
		result.$id = ctx.external.uri(id);
	}
	assignProps(result, root.defId ? root.schema : root.def ?? root.schema);
	const rootMetaId = ctx.metadataRegistry.get(schema)?.id;
	if (rootMetaId !== void 0 && result.id === rootMetaId) delete result.id;
	const defs = ctx.external?.defs ?? {};
	if (!ctx.external || ctx.sharedEmitDoneFor !== ctx.external) for (const entry of ctx.seen.entries()) {
		const seen = entry[1];
		if (seen.def && seen.defId) {
			if (seen.def.id === seen.defId) delete seen.def.id;
			assignProp(defs, seen.defId, seen.def);
		}
	}
	if (ctx.external) ctx.sharedEmitDoneFor = ctx.external;
	if (ctx.external) {} else if (Object.keys(defs).length > 0) {
		if (ctx.target === "draft-2020-12") result.$defs = defs;
		else result.definitions = defs;
	}
	try {
		const finalized = JSON.parse(JSON.stringify(result));
		Object.defineProperty(finalized, "~standard", {
			value: {
				...schema["~standard"],
				jsonSchema: {
					input: createStandardJSONSchemaMethod(schema, "input", ctx.processors),
					output: createStandardJSONSchemaMethod(schema, "output", ctx.processors)
				}
			},
			enumerable: false,
			writable: false
		});
		return finalized;
	} catch (_err) {
		throw new Error("Error converting schema to JSON.");
	}
}
function isTransforming(_schema, _ctx) {
	const ctx = _ctx ?? { seen: /* @__PURE__ */ new Set() };
	if (ctx.seen.has(_schema)) return false;
	ctx.seen.add(_schema);
	const def = _schema._zod.def;
	if (def.type === "transform") return true;
	if (def.type === "array") return isTransforming(def.element, ctx);
	if (def.type === "set") return isTransforming(def.valueType, ctx);
	if (def.type === "lazy") return isTransforming(def.getter(), ctx);
	if (def.type === "promise" || def.type === "optional" || def.type === "nonoptional" || def.type === "nullable" || def.type === "readonly" || def.type === "default" || def.type === "prefault" || def.type === "catch") return isTransforming(def.innerType, ctx);
	if (def.type === "intersection") return isTransforming(def.left, ctx) || isTransforming(def.right, ctx);
	if (def.type === "record" || def.type === "map") return isTransforming(def.keyType, ctx) || isTransforming(def.valueType, ctx);
	if (def.type === "pipe") {
		if (_schema._zod.traits.has("$ZodCodec")) return true;
		return isTransforming(def.in, ctx) || isTransforming(def.out, ctx);
	}
	if (def.type === "object") {
		for (const key in def.shape) if (isTransforming(def.shape[key], ctx)) return true;
		return false;
	}
	if (def.type === "union") {
		for (const option of def.options) if (isTransforming(option, ctx)) return true;
		return false;
	}
	if (def.type === "tuple") {
		for (const item of def.items) if (isTransforming(item, ctx)) return true;
		if (def.rest && isTransforming(def.rest, ctx)) return true;
		return false;
	}
	return false;
}
/**
* Creates a toJSONSchema method for a schema instance.
* This encapsulates the logic of initializing context, processing, extracting defs, and finalizing.
*/
const createToJSONSchemaMethod = (schema, processors = {}) => (params) => {
	const ctx = initializeContext({
		...params,
		processors
	});
	processSchema(schema, ctx);
	extractDefs(ctx, schema);
	return finalize(ctx, schema);
};
const createStandardJSONSchemaMethod = (schema, io, processors = {}) => (params) => {
	const { libraryOptions, target } = params ?? {};
	const ctx = initializeContext({
		...libraryOptions ?? {},
		target,
		io,
		processors
	});
	processSchema(schema, ctx);
	extractDefs(ctx, schema);
	return finalize(ctx, schema);
};
//#endregion
//#region ../../node_modules/.pnpm/zod@4.6.7/node_modules/zod/v4/core/json-schema-processors.js
const narrowMin = (agg, key, value) => {
	if (agg[key] === void 0 || value > agg[key]) agg[key] = value;
};
const narrowMax = (agg, key, value) => {
	if (agg[key] === void 0 || value < agg[key]) agg[key] = value;
};
const narrowBoth = (agg, value) => {
	narrowMin(agg, "minimum", value);
	narrowMax(agg, "maximum", value);
};
const addDivisor = (agg, value) => {
	agg.multipleOf ?? (agg.multipleOf = []);
	if (!agg.multipleOf.includes(value)) agg.multipleOf.push(value);
};
const addPattern = (agg, pattern) => {
	agg.patterns ?? (agg.patterns = /* @__PURE__ */ new Set());
	agg.patterns.add(pattern);
};
const intersectMime = (agg, mime) => {
	agg.mime = agg.mime ? agg.mime.filter((m) => mime.includes(m)) : [...mime];
};
const setFormat = (agg, format) => {
	agg.format = format;
	if (format.includes("int")) agg.isInt = true;
};
const minContributor = (agg, def) => narrowMin(agg, "minimum", def.minimum);
const maxContributor = (agg, def) => narrowMax(agg, "maximum", def.maximum);
const formatContributor = (ranges) => (agg, def) => {
	setFormat(agg, def.format);
	const [minimum, maximum] = ranges[def.format];
	narrowMin(agg, "minimum", minimum);
	narrowMax(agg, "maximum", maximum);
};
const contributors = {
	greater_than: (agg, def) => narrowMin(agg, def.inclusive ? "minimum" : "exclusiveMinimum", def.value),
	less_than: (agg, def) => narrowMax(agg, def.inclusive ? "maximum" : "exclusiveMaximum", def.value),
	multiple_of: (agg, def) => addDivisor(agg, def.value),
	number_format: formatContributor(NUMBER_FORMAT_RANGES),
	bigint_format: formatContributor(BIGINT_FORMAT_RANGES),
	min_length: minContributor,
	max_length: maxContributor,
	length_equals: (agg, def) => narrowBoth(agg, def.length),
	min_size: minContributor,
	max_size: maxContributor,
	size_equals: (agg, def) => narrowBoth(agg, def.size),
	string_format: (agg, def) => {
		setFormat(agg, def.format);
		if (def.pattern) addPattern(agg, def.pattern);
		if (def.format === "base64" || def.format === "base64url") agg.contentEncoding = def.format;
		if (def.local || def.precision === -1) agg.laxFormat = true;
	},
	mime_type: (agg, def) => intersectMime(agg, def.mime)
};
function aggregateChecks(schema) {
	const agg = {};
	const def = schema._zod.def;
	const list = schema._zod.traits.has("$ZodCheck") ? [schema, ...def.checks ?? []] : def.checks ?? [];
	for (const ch of list) contributors[ch._zod.def.check]?.(agg, ch._zod.def);
	const bag = schema._zod.bag;
	if (bag.minimum !== void 0) narrowMin(agg, "minimum", bag.minimum);
	if (bag.exclusiveMinimum !== void 0) narrowMin(agg, "exclusiveMinimum", bag.exclusiveMinimum);
	if (bag.maximum !== void 0) narrowMax(agg, "maximum", bag.maximum);
	if (bag.exclusiveMaximum !== void 0) narrowMax(agg, "exclusiveMaximum", bag.exclusiveMaximum);
	if (bag.multipleOf !== void 0) addDivisor(agg, bag.multipleOf);
	if (bag.format !== void 0) {
		agg.format ?? (agg.format = bag.format);
		if (bag.format.includes("int")) agg.isInt = true;
	}
	if (bag.mime) intersectMime(agg, bag.mime);
	for (const pattern of bag.patterns ?? []) addPattern(agg, pattern);
	return agg;
}
const formatMap = {
	guid: "uuid",
	url: "uri",
	datetime: "date-time",
	json_string: "json-string",
	regex: ""
};
const exactPatterns = /* @__PURE__ */ new Map([[base64Charset, base64], [base64urlCharset, base64url]]);
const exactPattern = (p) => exactPatterns.get(p) ?? p;
const stringProcessor = (schema, ctx, _json, _params) => {
	const json = _json;
	json.type = "string";
	const { minimum, maximum, format, patterns, contentEncoding, laxFormat } = aggregateChecks(schema);
	if (typeof minimum === "number") json.minLength = minimum;
	if (typeof maximum === "number") json.maxLength = maximum;
	if (format) {
		json.format = formatMap[format] ?? format;
		if (json.format === "") delete json.format;
		if (format === "time" || laxFormat) delete json.format;
	}
	if (contentEncoding) json.contentEncoding = contentEncoding;
	if (patterns && patterns.size > 0) {
		const patternList = [...patterns].map(exactPattern);
		if (patternList.length === 1) json.pattern = patternList[0].source;
		else if (patternList.length > 1) json.allOf = [...patternList.map((regex) => ({
			...ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0" ? { type: "string" } : {},
			pattern: regex.source
		}))];
	}
};
const numberProcessor = (schema, ctx, _json, params) => {
	const json = _json;
	const { minimum, maximum, multipleOf, exclusiveMaximum, exclusiveMinimum, isInt } = aggregateChecks(schema);
	json.type = isInt ? "integer" : "number";
	const exMin = typeof exclusiveMinimum === "number" && exclusiveMinimum >= (minimum ?? Number.NEGATIVE_INFINITY);
	const exMax = typeof exclusiveMaximum === "number" && exclusiveMaximum <= (maximum ?? Number.POSITIVE_INFINITY);
	const legacy = ctx.target === "draft-04" || ctx.target === "openapi-3.0";
	if (exMin) {
		if (legacy) {
			json.minimum = exclusiveMinimum;
			json.exclusiveMinimum = true;
		} else json.exclusiveMinimum = exclusiveMinimum;
	} else if (typeof minimum === "number") json.minimum = minimum;
	if (exMax) {
		if (legacy) {
			json.maximum = exclusiveMaximum;
			json.exclusiveMaximum = true;
		} else json.exclusiveMaximum = exclusiveMaximum;
	} else if (typeof maximum === "number") json.maximum = maximum;
	if (multipleOf) {
		const divisors = /* @__PURE__ */ new Set();
		for (const divisor of multipleOf) if (Number.isFinite(divisor) && divisor !== 0) divisors.add(Math.abs(divisor));
		else handleUnrepresentable(schema, ctx, json, params, `A multipleOf divisor of ${divisor} cannot be represented in JSON Schema`);
		const [first, ...rest] = divisors;
		if (first !== void 0) json.multipleOf = first;
		if (rest.length) json.allOf = [...json.allOf ?? [], ...rest.map((m) => ({ multipleOf: m }))];
	}
};
const booleanProcessor = (_schema, _ctx, json, _params) => {
	json.type = "boolean";
};
const neverProcessor = (_schema, _ctx, json, _params) => {
	json.not = {};
};
const enumProcessor = (schema, _ctx, json, _params) => {
	const def = schema._zod.def;
	const values = getEnumValues(def.entries);
	if (values.length === 0) {
		json.not = {};
		return;
	}
	if (values.every((v) => typeof v === "number")) json.type = "number";
	if (values.every((v) => typeof v === "string")) json.type = "string";
	json.enum = values;
};
const literalProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	if (def.values.length === 0) {
		json.not = {};
		return;
	}
	const vals = [];
	for (const val of def.values) if (val === void 0) {
		if (handleUnrepresentable(schema, ctx, json, params, "Literal `undefined` cannot be represented in JSON Schema")) return;
	} else if (typeof val === "bigint") {
		if (handleUnrepresentable(schema, ctx, json, params, "BigInt literals cannot be represented in JSON Schema")) return;
		vals.push(Number(val));
	} else vals.push(val);
	if (vals.length === 0) {} else if (vals.length === 1) {
		const val = vals[0];
		json.type = val === null ? "null" : typeof val;
		if (ctx.target === "draft-04" || ctx.target === "openapi-3.0") json.enum = [val];
		else json.const = val;
	} else {
		if (vals.every((v) => typeof v === "number")) json.type = "number";
		if (vals.every((v) => typeof v === "string")) json.type = "string";
		if (vals.every((v) => typeof v === "boolean")) json.type = "boolean";
		if (vals.every((v) => v === null)) json.type = "null";
		json.enum = vals;
	}
};
const customProcessor = (schema, ctx, json, params) => {
	handleUnrepresentable(schema, ctx, json, params, "Custom types cannot be represented in JSON Schema");
};
const transformProcessor = (schema, ctx, json, params) => {
	handleUnrepresentable(schema, ctx, json, params, "Transforms cannot be represented in JSON Schema");
};
const arrayProcessor = (schema, ctx, _json, params) => {
	const json = _json;
	const def = schema._zod.def;
	const { minimum, maximum } = aggregateChecks(schema);
	if (typeof minimum === "number") json.minItems = minimum;
	if (typeof maximum === "number") json.maxItems = maximum;
	json.type = "array";
	json.items = processSchema(def.element, ctx, {
		...params,
		path: [...params.path, "items"]
	});
};
function inputOptin(schema) {
	const def = schema._zod.def;
	if (def.type === "pipe" && def.in._zod.traits.has("$ZodTransform")) return inputOptin(def.out);
	if (def.type === "catch") return inputOptin(def.innerType);
	return schema._zod.optin;
}
const objectProcessor = (schema, ctx, _json, params) => {
	const json = _json;
	const def = schema._zod.def;
	const shape = def.shape;
	if (Object.getOwnPropertySymbols(shape).length && handleUnrepresentable(schema, ctx, json, params, "Symbol keys cannot be represented in JSON Schema")) return;
	json.type = "object";
	json.properties = {};
	for (const key in shape) assignProp(json.properties, key, processSchema(shape[key], ctx, {
		...params,
		path: [
			...params.path,
			"properties",
			key
		]
	}));
	const requiredKeys = [];
	for (const key of Object.keys(shape)) {
		const field = def.shape[key];
		if (ctx.io === "input" ? inputOptin(field) === void 0 : field._zod.optout === void 0) requiredKeys.push(key);
	}
	if (requiredKeys.length > 0) json.required = requiredKeys;
	if (def.catchall?._zod.def.type === "never") json.additionalProperties = false;
	else if (!def.catchall) {
		if (ctx.io === "output") json.additionalProperties = false;
	} else if (def.catchall) json.additionalProperties = processSchema(def.catchall, ctx, {
		...params,
		path: [...params.path, "additionalProperties"]
	});
};
const unionProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	const isExclusive = def.inclusive === false;
	const options = def.options.map((x, i) => processSchema(x, ctx, {
		...params,
		path: [
			...params.path,
			isExclusive ? "oneOf" : "anyOf",
			i
		]
	}));
	if (isExclusive) json.oneOf = options;
	else json.anyOf = options;
};
const intersectionProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	const a = processSchema(def.left, ctx, {
		...params,
		path: [
			...params.path,
			"allOf",
			0
		]
	});
	const b = processSchema(def.right, ctx, {
		...params,
		path: [
			...params.path,
			"allOf",
			1
		]
	});
	const isSimpleIntersection = (val) => "allOf" in val && Object.keys(val).length === 1;
	const allOf = [...isSimpleIntersection(a) ? a.allOf : [a], ...isSimpleIntersection(b) ? b.allOf : [b]];
	json.allOf = allOf;
	ctx.intersections.push(allOf);
};
/** JSON object keys are always strings, so a numeric record key schema is re-expressed over the
* numeric-string form the record parser matches. Deferred to `finalize`, after the flatten: a key
* behind a wrapper only carries its own `type` before then, and a union key only has its branches.
*
* A numeric bound cannot apply to a property name, so `minimum` and its siblings are dropped rather
* than carried over: keeping them beside `type: "string"` reproduces the match-nothing schema this
* exists to fix. A key that carries one therefore emits wider than the record parses — `z.record(z.number().min(5), V)`
* accepts `"3"` — which is the deliberate trade, since throwing on it would reject an ordinary schema
* outright. */
function stringifyKeyNames(bySchema, json, visited) {
	if (json.$ref) {
		if (visited.has(json)) return json;
		visited.add(json);
		const def = bySchema.get(json)?.def;
		if (!def) return json;
		const inlined = stringifyKeyNames(bySchema, def, visited);
		return inlined === def ? json : inlined;
	}
	for (const keyword of ["anyOf", "oneOf"]) {
		const branches = json[keyword];
		if (!Array.isArray(branches)) continue;
		const mapped = branches.map((branch) => stringifyKeyNames(bySchema, branch, visited));
		if (mapped.some((branch, i) => branch !== branches[i])) json = {
			...json,
			[keyword]: mapped
		};
	}
	const types = Array.isArray(json.type) ? json.type : [json.type];
	const numericType = !types.includes("string") && types.some((t) => t === "number" || t === "integer");
	const values = json.enum ?? (json.const !== void 0 ? [json.const] : void 0);
	if (!numericType && !values?.some((v) => typeof v === "number")) return json;
	const { minimum, maximum, exclusiveMinimum, exclusiveMaximum, multipleOf, format, id, ...rest } = json;
	if (rest.enum) rest.enum = rest.enum.map((v) => typeof v === "number" ? String(v) : v);
	else if (typeof rest.const === "number") rest.const = String(rest.const);
	if (!numericType) return rest;
	rest.type = "string";
	if (!values) rest.pattern = (types.includes("number") ? number$1 : integer).source;
	return rest;
}
/** Every record of one conversion, so the carriers are found in a single pass rather than once per record. */
const pendingRecords = /* @__PURE__ */ new WeakMap();
function rewriteKeyNames(ctx) {
	const bySchema = /* @__PURE__ */ new Map();
	for (const entry of ctx.seen.values()) if (entry.def && !bySchema.has(entry.schema)) bySchema.set(entry.schema, entry);
	const rewrites = /* @__PURE__ */ new Map();
	for (const record of pendingRecords.get(ctx) ?? []) {
		const seen = ctx.seen.get(record);
		const names = (seen?.def ?? seen?.schema)?.propertyNames;
		if (!names || names === true || rewrites.has(names)) continue;
		const rewritten = stringifyKeyNames(bySchema, names, /* @__PURE__ */ new Set());
		if (rewritten !== names) rewrites.set(names, rewritten);
	}
	if (!rewrites.size) return;
	for (const entry of ctx.seen.values()) for (const carrier of [entry.schema, entry.def]) {
		const rewritten = carrier && rewrites.get(carrier.propertyNames);
		if (rewritten) carrier.propertyNames = rewritten;
	}
}
const recordProcessor = (schema, ctx, _json, params) => {
	const json = _json;
	const def = schema._zod.def;
	json.type = "object";
	const keyType = def.keyType;
	const patterns = aggregateChecks(keyType).patterns;
	if (def.mode === "loose" && patterns && patterns.size > 0) {
		const valueSchema = processSchema(def.valueType, ctx, {
			...params,
			path: [
				...params.path,
				"patternProperties",
				"*"
			]
		});
		json.patternProperties = {};
		for (const pattern of patterns) assignProp(json.patternProperties, exactPattern(pattern).source, valueSchema);
	} else {
		if (ctx.target === "draft-07" || ctx.target === "draft-2020-12") {
			json.propertyNames = processSchema(def.keyType, ctx, {
				...params,
				path: [...params.path, "propertyNames"]
			});
			let pending = pendingRecords.get(ctx);
			if (!pending) {
				pending = [];
				pendingRecords.set(ctx, pending);
				ctx.deferred.push(() => rewriteKeyNames(ctx));
			}
			pending.push(schema);
		}
		json.additionalProperties = processSchema(def.valueType, ctx, {
			...params,
			path: [...params.path, "additionalProperties"]
		});
	}
	const keyValues = keyType._zod.values;
	const omittableOnInput = ctx.io === "input" && inputOptin(def.valueType) !== void 0;
	if (keyValues && !def.partial && !omittableOnInput) {
		const validKeyValues = [...keyValues].filter((v) => typeof v === "string" || typeof v === "number");
		if (validKeyValues.length > 0) json.required = validKeyValues.map(String);
	}
};
const nullableProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	const inner = processSchema(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	if (ctx.target === "openapi-3.0") {
		seen.ref = def.innerType;
		json.nullable = true;
	} else json.anyOf = [inner, { type: "null" }];
};
const nonoptionalProcessor = (schema, ctx, _json, params) => {
	const def = schema._zod.def;
	processSchema(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = def.innerType;
};
/** Round-trips a default value through JSON so the emitted schema is guaranteed to be valid JSON.
* A BigInt has no reliable encoding, so it goes through `unrepresentable` like any other
* unrepresentable value. Returns a sentinel when the caller must not write a default of its own. */
const UNREPRESENTABLE_DEFAULT = Symbol();
function serializeDefaultValue(value, schema, ctx, json, params) {
	let unrepresentable = false;
	const serialized = JSON.stringify(value, (_, val) => {
		if (typeof val !== "bigint") return val;
		unrepresentable = true;
		return null;
	});
	if (!unrepresentable) return JSON.parse(serialized);
	handleUnrepresentable(schema, ctx, json, params, "BigInt defaults cannot be represented in JSON Schema");
	return UNREPRESENTABLE_DEFAULT;
}
const defaultProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	processSchema(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = def.innerType;
	const value = serializeDefaultValue(def.defaultValue, schema, ctx, json, params);
	if (value !== UNREPRESENTABLE_DEFAULT) json.default = value;
};
const prefaultProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	processSchema(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = def.innerType;
	if (ctx.io !== "input") return;
	const value = serializeDefaultValue(def.defaultValue, schema, ctx, json, params);
	if (value !== UNREPRESENTABLE_DEFAULT) json._prefault = value;
};
const catchProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	processSchema(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = def.innerType;
	let catchValue;
	try {
		catchValue = def.catchValue(void 0);
	} catch {
		handleUnrepresentable(schema, ctx, json, params, "Dynamic catch values are not supported in JSON Schema");
		return;
	}
	json.default = catchValue;
};
const pipeProcessor = (schema, ctx, _json, params) => {
	const def = schema._zod.def;
	const inIsTransform = def.in._zod.traits.has("$ZodTransform");
	const innerType = ctx.io === "input" ? inIsTransform ? def.out : def.in : def.out;
	processSchema(innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = innerType;
};
const readonlyProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	processSchema(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = def.innerType;
	json.readOnly = true;
};
const optionalProcessor = (schema, ctx, _json, params) => {
	const def = schema._zod.def;
	processSchema(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = def.innerType;
};
//#endregion
//#region ../../node_modules/.pnpm/zod@4.6.7/node_modules/zod/v4/classic/errors.js
const _installedErrorProtos = /* @__PURE__ */ new WeakSet([Object.prototype, Error.prototype]);
function _lazyMethod(proto, key, make) {
	Object.defineProperty(proto, key, {
		configurable: true,
		enumerable: false,
		get() {
			const value = make(this);
			Object.defineProperty(this, key, {
				value,
				configurable: true,
				writable: true
			});
			return value;
		},
		set(value) {
			Object.defineProperty(this, key, {
				value,
				configurable: true,
				writable: true
			});
		}
	});
}
const initializer = (inst, issues) => {
	$ZodError.init(inst, issues);
	inst.name = "ZodError";
	const proto = Object.getPrototypeOf(inst);
	if (_installedErrorProtos.has(proto)) return;
	_installedErrorProtos.add(proto);
	_lazyMethod(proto, "format", (self) => (mapper) => formatError(self, mapper));
	_lazyMethod(proto, "flatten", (self) => (mapper) => flattenError(self, mapper));
	_lazyMethod(proto, "addIssue", (self) => (issue) => {
		self.issues.push(issue);
		self.message = JSON.stringify(self.issues, jsonStringifyReplacer, 2);
	});
	_lazyMethod(proto, "addIssues", (self) => (issues) => {
		self.issues.push(...issues);
		self.message = JSON.stringify(self.issues, jsonStringifyReplacer, 2);
	});
	Object.defineProperty(proto, "isEmpty", {
		configurable: true,
		enumerable: false,
		get() {
			return this.issues.length === 0;
		}
	});
};
const ZodRealError = /*@__PURE__*/ $constructor("ZodError", initializer, void 0, { Parent: Error });
//#endregion
//#region ../../node_modules/.pnpm/zod@4.6.7/node_modules/zod/v4/classic/parse.js
const parse = /* @__PURE__ */ _parse(ZodRealError);
const parseAsync = /* @__PURE__ */ _parseAsync(ZodRealError);
const safeParse = /* @__PURE__ */ _safeParse(ZodRealError);
const safeParseAsync = /* @__PURE__ */ _safeParseAsync(ZodRealError);
const encode = /* @__PURE__ */ _encode(ZodRealError);
const decode = /* @__PURE__ */ _decode(ZodRealError);
const encodeAsync = /* @__PURE__ */ _encodeAsync(ZodRealError);
const decodeAsync = /* @__PURE__ */ _decodeAsync(ZodRealError);
const safeEncode = /* @__PURE__ */ _safeEncode(ZodRealError);
const safeDecode = /* @__PURE__ */ _safeDecode(ZodRealError);
const safeEncodeAsync = /* @__PURE__ */ _safeEncodeAsync(ZodRealError);
const safeDecodeAsync = /* @__PURE__ */ _safeDecodeAsync(ZodRealError);
//#endregion
//#region ../../node_modules/.pnpm/zod@4.6.7/node_modules/zod/v4/classic/schemas.js
function _ensureDefaultLocale() {
	if (!globalConfig.localeError) config(en_default());
}
function _ensureDefaultMemoizer() {
	if (!globalConfig.memoizer) config({ memoizer: memoizer() });
}
const ZodType = /*@__PURE__*/ $constructor("ZodType", (inst, def) => {
	_ensureDefaultLocale();
	$ZodType.init(inst, def);
	inst.def = def;
	inst.type = def.type;
	return inst;
}, {
	check(...chks) {
		const def = this.def;
		return this.clone(mergeDefs(def, { checks: [...def.checks ?? [], ...chks.map((ch) => typeof ch === "function" ? { _zod: {
			check: ch,
			def: { check: "custom" },
			onattach: []
		} } : ch)] }), { parent: true });
	},
	with(...chks) {
		return this.check(...chks);
	},
	clone(def, params) {
		return clone(this, def, params);
	},
	brand() {
		return this;
	},
	register(reg, meta) {
		reg.add(this, meta);
		return this;
	},
	refine(check, params) {
		return this.check(refine(check, params));
	},
	superRefine(refinement, params) {
		return this.check(superRefine(refinement, params));
	},
	overwrite(fn) {
		return this.check(/* @__PURE__ */ _overwrite(fn));
	},
	optional() {
		return optional(this);
	},
	exactOptional() {
		return exactOptional(this);
	},
	nullable() {
		return nullable(this);
	},
	nullish() {
		return optional(nullable(this));
	},
	nonoptional(params) {
		return nonoptional(this, params);
	},
	array() {
		return array(this);
	},
	or(arg) {
		return union([this, arg]);
	},
	and(arg) {
		return intersection(this, arg);
	},
	transform(tx) {
		return pipe(this, transform(tx));
	},
	default(d) {
		return _default(this, d);
	},
	prefault(d) {
		return prefault(this, d);
	},
	catch(params) {
		return _catch(this, params);
	},
	pipe(target) {
		return pipe(this, target);
	},
	readonly() {
		return readonly(this);
	},
	describe(description) {
		const cl = this.clone();
		globalRegistry.add(cl, { description });
		return cl;
	},
	meta(...args) {
		if (args.length === 0) return globalRegistry.get(this);
		const cl = this.clone();
		globalRegistry.add(cl, args[0]);
		return cl;
	},
	isOptional() {
		return this.safeParse(void 0).success;
	},
	isNullable() {
		return this.safeParse(null).success;
	},
	apply(fn, ...args) {
		return args.length === 0 ? fn(this) : fn(this, ...args);
	},
	get "~standard"() {
		return hide(this, "~standard", {
			...standardProps(this),
			jsonSchema: {
				input: createStandardJSONSchemaMethod(this, "input"),
				output: createStandardJSONSchemaMethod(this, "output")
			}
		});
	},
	set "~standard"(value) {
		own(this, "~standard", value);
	},
	parse: function _parse(data, params) {
		return parse(this, data, params, { callee: _parse });
	},
	parseAsync: async function _parseAsync(data, params) {
		return await parseAsync(this, data, params, { callee: _parseAsync });
	},
	safeParse(data, params) {
		return safeParse(this, data, params);
	},
	async safeParseAsync(data, params) {
		return safeParseAsync(this, data, params);
	},
	get spa() {
		return this?.safeParseAsync;
	},
	set spa(value) {
		own(this, "spa", value);
	},
	validate(data, params) {
		return validate(this, data, params);
	},
	validateAsync(data, params) {
		return validateAsync$1(this, data, params);
	},
	encode: function _encode(data, params) {
		return encode(this, data, params, { callee: _encode });
	},
	decode: function _decode(data, params) {
		return decode(this, data, params, { callee: _decode });
	},
	encodeAsync: async function _encodeAsync(data, params) {
		return await encodeAsync(this, data, params, { callee: _encodeAsync });
	},
	decodeAsync: async function _decodeAsync(data, params) {
		return await decodeAsync(this, data, params, { callee: _decodeAsync });
	},
	safeEncode(data, params) {
		return safeEncode(this, data, params);
	},
	safeDecode(data, params) {
		return safeDecode(this, data, params);
	},
	async safeEncodeAsync(data, params) {
		return safeEncodeAsync(this, data, params);
	},
	async safeDecodeAsync(data, params) {
		return safeDecodeAsync(this, data, params);
	},
	toJSONSchema(params) {
		return createToJSONSchemaMethod(this, {})(params);
	},
	get description() {
		return globalRegistry.get(this)?.description;
	},
	get _def() {
		return this._zod.def;
	}
});
/** @internal */
const _ZodString = /*@__PURE__*/ $constructor("_ZodString", (inst, def) => {
	$ZodString.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => stringProcessor(inst, ctx, json, params);
}, /*@__PURE__*/ derived({
	format: (inst) => aggregateChecks(inst).format ?? null,
	minLength: (inst) => aggregateChecks(inst).minimum ?? null,
	maxLength: (inst) => aggregateChecks(inst).maximum ?? null
}, {
	regex(...args) {
		return this.check(/* @__PURE__ */ _regex(...args));
	},
	includes(...args) {
		return this.check(/* @__PURE__ */ _includes(...args));
	},
	startsWith(...args) {
		return this.check(/* @__PURE__ */ _startsWith(...args));
	},
	endsWith(...args) {
		return this.check(/* @__PURE__ */ _endsWith(...args));
	},
	min(...args) {
		return this.check(/* @__PURE__ */ _minLength(...args));
	},
	max(...args) {
		return this.check(/* @__PURE__ */ _maxLength(...args));
	},
	length(...args) {
		return this.check(/* @__PURE__ */ _length(...args));
	},
	nonempty(...args) {
		return this.check(/* @__PURE__ */ _minLength(1, ...args));
	},
	lowercase(params) {
		return this.check(/* @__PURE__ */ _lowercase(params));
	},
	uppercase(params) {
		return this.check(/* @__PURE__ */ _uppercase(params));
	},
	trim() {
		return this.check(/* @__PURE__ */ _trim());
	},
	normalize(...args) {
		return this.check(/* @__PURE__ */ _normalize(...args));
	},
	toLowerCase() {
		return this.check(/* @__PURE__ */ _toLowerCase());
	},
	toUpperCase() {
		return this.check(/* @__PURE__ */ _toUpperCase());
	},
	slugify() {
		return this.check(/* @__PURE__ */ _slugify());
	}
}));
const ZodString = /*@__PURE__*/ $constructor("ZodString", (inst, def) => {
	$ZodString.init(inst, def);
	_ZodString.init(inst, def);
}, {
	email(params) {
		return this.check(/* @__PURE__ */ _email(ZodEmail, params));
	},
	url(params) {
		return this.check(/* @__PURE__ */ _url(ZodURL, params));
	},
	jwt(params) {
		return this.check(/* @__PURE__ */ _jwt(ZodJWT, params));
	},
	emoji(params) {
		return this.check(/* @__PURE__ */ _emoji(ZodEmoji, params));
	},
	guid(params) {
		return this.check(/* @__PURE__ */ _guid(ZodGUID, params));
	},
	uuid(params) {
		return this.check(/* @__PURE__ */ _uuid(ZodUUID, params));
	},
	uuidv4(params) {
		return this.check(/* @__PURE__ */ _uuidv4(ZodUUID, params));
	},
	uuidv6(params) {
		return this.check(/* @__PURE__ */ _uuidv6(ZodUUID, params));
	},
	uuidv7(params) {
		return this.check(/* @__PURE__ */ _uuidv7(ZodUUID, params));
	},
	nanoid(params) {
		return this.check(/* @__PURE__ */ _nanoid(ZodNanoID, params));
	},
	cuid(params) {
		return this.check(/* @__PURE__ */ _cuid(ZodCUID, params));
	},
	cuid2(params) {
		return this.check(/* @__PURE__ */ _cuid2(ZodCUID2, params));
	},
	ulid(params) {
		return this.check(/* @__PURE__ */ _ulid(ZodULID, params));
	},
	base64(params) {
		return this.check(/* @__PURE__ */ _base64(ZodBase64, params));
	},
	base64url(params) {
		return this.check(/* @__PURE__ */ _base64url(ZodBase64URL, params));
	},
	xid(params) {
		return this.check(/* @__PURE__ */ _xid(ZodXID, params));
	},
	ksuid(params) {
		return this.check(/* @__PURE__ */ _ksuid(ZodKSUID, params));
	},
	ipv4(params) {
		return this.check(/* @__PURE__ */ _ipv4(ZodIPv4, params));
	},
	ipv6(params) {
		return this.check(/* @__PURE__ */ _ipv6(ZodIPv6, params));
	},
	cidrv4(params) {
		return this.check(/* @__PURE__ */ _cidrv4(ZodCIDRv4, params));
	},
	cidrv6(params) {
		return this.check(/* @__PURE__ */ _cidrv6(ZodCIDRv6, params));
	},
	e164(params) {
		return this.check(/* @__PURE__ */ _e164(ZodE164, params));
	},
	datetime(params) {
		return this.check(/* @__PURE__ */ _isoDateTime(ZodISODateTime, params));
	},
	date(params) {
		return this.check(/* @__PURE__ */ _isoDate(ZodISODate, params));
	},
	time(params) {
		return this.check(/* @__PURE__ */ _isoTime(ZodISOTime, params));
	},
	duration(params) {
		return this.check(/* @__PURE__ */ _isoDuration(ZodISODuration, params));
	}
});
function string(params) {
	return /* @__PURE__ */ _string(ZodString, params);
}
const ZodStringFormat = /*@__PURE__*/ $constructor("ZodStringFormat", (inst, def) => {
	$ZodStringFormat.init(inst, def);
	_ZodString.init(inst, def);
});
const ZodISODateTime = /*@__PURE__*/ $constructor("ZodISODateTime", (inst, def) => {
	$ZodISODateTime.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodISODate = /*@__PURE__*/ $constructor("ZodISODate", (inst, def) => {
	$ZodISODate.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodISOTime = /*@__PURE__*/ $constructor("ZodISOTime", (inst, def) => {
	$ZodISOTime.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodISODuration = /*@__PURE__*/ $constructor("ZodISODuration", (inst, def) => {
	$ZodISODuration.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodEmail = /*@__PURE__*/ $constructor("ZodEmail", (inst, def) => {
	$ZodEmail.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodGUID = /*@__PURE__*/ $constructor("ZodGUID", (inst, def) => {
	$ZodGUID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodUUID = /*@__PURE__*/ $constructor("ZodUUID", (inst, def) => {
	$ZodUUID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodURL = /*@__PURE__*/ $constructor("ZodURL", (inst, def) => {
	$ZodURL.init(inst, def);
	ZodStringFormat.init(inst, def);
});
function url(params) {
	return /* @__PURE__ */ _url(ZodURL, params);
}
const ZodEmoji = /*@__PURE__*/ $constructor("ZodEmoji", (inst, def) => {
	$ZodEmoji.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodNanoID = /*@__PURE__*/ $constructor("ZodNanoID", (inst, def) => {
	$ZodNanoID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
/**
* @deprecated CUID v1 is deprecated by its authors due to information leakage
* (timestamps embedded in the id). Use {@link ZodCUID2} instead.
* See https://github.com/paralleldrive/cuid.
*/
const ZodCUID = /*@__PURE__*/ $constructor("ZodCUID", (inst, def) => {
	$ZodCUID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodCUID2 = /*@__PURE__*/ $constructor("ZodCUID2", (inst, def) => {
	$ZodCUID2.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodULID = /*@__PURE__*/ $constructor("ZodULID", (inst, def) => {
	$ZodULID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodXID = /*@__PURE__*/ $constructor("ZodXID", (inst, def) => {
	$ZodXID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodKSUID = /*@__PURE__*/ $constructor("ZodKSUID", (inst, def) => {
	$ZodKSUID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodIPv4 = /*@__PURE__*/ $constructor("ZodIPv4", (inst, def) => {
	$ZodIPv4.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodIPv6 = /*@__PURE__*/ $constructor("ZodIPv6", (inst, def) => {
	$ZodIPv6.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodCIDRv4 = /*@__PURE__*/ $constructor("ZodCIDRv4", (inst, def) => {
	$ZodCIDRv4.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodCIDRv6 = /*@__PURE__*/ $constructor("ZodCIDRv6", (inst, def) => {
	$ZodCIDRv6.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodBase64 = /*@__PURE__*/ $constructor("ZodBase64", (inst, def) => {
	$ZodBase64.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodBase64URL = /*@__PURE__*/ $constructor("ZodBase64URL", (inst, def) => {
	$ZodBase64URL.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodE164 = /*@__PURE__*/ $constructor("ZodE164", (inst, def) => {
	$ZodE164.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodJWT = /*@__PURE__*/ $constructor("ZodJWT", (inst, def) => {
	$ZodJWT.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodNumber = /*@__PURE__*/ $constructor("ZodNumber", (inst, def) => {
	$ZodNumber.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => numberProcessor(inst, ctx, json, params);
	inst.isFinite = true;
}, /*@__PURE__*/ derived({
	minValue: (inst) => {
		const { minimum, exclusiveMinimum } = aggregateChecks(inst);
		return Math.max(minimum ?? Number.NEGATIVE_INFINITY, exclusiveMinimum ?? Number.NEGATIVE_INFINITY);
	},
	maxValue: (inst) => {
		const { maximum, exclusiveMaximum } = aggregateChecks(inst);
		return Math.min(maximum ?? Number.POSITIVE_INFINITY, exclusiveMaximum ?? Number.POSITIVE_INFINITY);
	},
	isInt: (inst) => {
		const { isInt, multipleOf } = aggregateChecks(inst);
		return !!isInt || !!multipleOf?.some(Number.isSafeInteger);
	},
	format: (inst) => aggregateChecks(inst).format ?? null
}, {
	gt(value, params) {
		return this.check(/* @__PURE__ */ _gt(value, params));
	},
	gte(value, params) {
		return this.check(/* @__PURE__ */ _gte(value, params));
	},
	min(value, params) {
		return this.check(/* @__PURE__ */ _gte(value, params));
	},
	lt(value, params) {
		return this.check(/* @__PURE__ */ _lt(value, params));
	},
	lte(value, params) {
		return this.check(/* @__PURE__ */ _lte(value, params));
	},
	max(value, params) {
		return this.check(/* @__PURE__ */ _lte(value, params));
	},
	int(params) {
		return this.check(int(params));
	},
	safe(params) {
		return this.check(int(params));
	},
	positive(params) {
		return this.check(/* @__PURE__ */ _gt(0, params));
	},
	nonnegative(params) {
		return this.check(/* @__PURE__ */ _gte(0, params));
	},
	negative(params) {
		return this.check(/* @__PURE__ */ _lt(0, params));
	},
	nonpositive(params) {
		return this.check(/* @__PURE__ */ _lte(0, params));
	},
	multipleOf(value, params) {
		return this.check(/* @__PURE__ */ _multipleOf(value, params));
	},
	step(value, params) {
		return this.check(/* @__PURE__ */ _multipleOf(value, params));
	},
	finite() {
		return this;
	}
}));
function number(params) {
	return /* @__PURE__ */ _number(ZodNumber, params);
}
const ZodNumberFormat = /*@__PURE__*/ $constructor("ZodNumberFormat", (inst, def) => {
	$ZodNumberFormat.init(inst, def);
	ZodNumber.init(inst, def);
});
function int(params) {
	return /* @__PURE__ */ _int(ZodNumberFormat, params);
}
const ZodBoolean = /*@__PURE__*/ $constructor("ZodBoolean", (inst, def) => {
	$ZodBoolean.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => booleanProcessor(inst, ctx, json, params);
});
function boolean(params) {
	return /* @__PURE__ */ _boolean(ZodBoolean, params);
}
const ZodUnknown = /*@__PURE__*/ $constructor("ZodUnknown", (inst, def) => {
	$ZodUnknown.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => void 0;
});
function unknown() {
	return /* @__PURE__ */ _unknown(ZodUnknown);
}
const ZodNever = /*@__PURE__*/ $constructor("ZodNever", (inst, def) => {
	$ZodNever.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => neverProcessor(inst, ctx, json, params);
});
function never(params) {
	return /* @__PURE__ */ _never(ZodNever, params);
}
const ZodArray = /*@__PURE__*/ $constructor("ZodArray", (inst, def) => {
	_ensureDefaultMemoizer();
	$ZodArray.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => arrayProcessor(inst, ctx, json, params);
	inst.element = def.element;
}, {
	min(n, params) {
		return this.check(/* @__PURE__ */ _minLength(n, params));
	},
	nonempty(params) {
		return this.check(/* @__PURE__ */ _minLength(1, params));
	},
	max(n, params) {
		return this.check(/* @__PURE__ */ _maxLength(n, params));
	},
	length(n, params) {
		return this.check(/* @__PURE__ */ _length(n, params));
	},
	unwrap() {
		return this.element;
	}
});
function array(element, params) {
	return /* @__PURE__ */ _array(ZodArray, element, params);
}
const ZodObject = /*@__PURE__*/ $constructor("ZodObject", (inst, def) => {
	_ensureDefaultMemoizer();
	$ZodObjectJIT.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => objectProcessor(inst, ctx, json, params);
	installLazyProp(inst, "shape", (self) => self._zod.def.shape, false);
}, {
	keyof() {
		return _enum(Object.keys(this._zod.def.shape));
	},
	catchall(catchall) {
		return this.clone(mergeDefs(this._zod.def, { catchall }));
	},
	passthrough() {
		return this.clone(mergeDefs(this._zod.def, { catchall: unknown() }));
	},
	loose() {
		return this.clone(mergeDefs(this._zod.def, { catchall: unknown() }));
	},
	strict() {
		return this.clone(mergeDefs(this._zod.def, { catchall: never() }));
	},
	strip() {
		return this.clone(mergeDefs(this._zod.def, { catchall: void 0 }));
	},
	extend(incoming) {
		return extend(this, incoming);
	},
	safeExtend(incoming) {
		return safeExtend(this, incoming);
	},
	merge(other) {
		return merge(this, other);
	},
	pick(mask) {
		return pick(this, mask);
	},
	omit(mask) {
		return omit(this, mask);
	},
	partial(...args) {
		return partial(ZodOptional, this, args[0]);
	},
	exactPartial(...args) {
		return partial(ZodExactOptional, this, args[0], "exactPartial");
	},
	required(...args) {
		return required(ZodNonOptional, this, args[0]);
	}
});
function object(shape, params) {
	const def = {
		type: "object",
		shape: shape ?? {},
		...normalizeParams(params)
	};
	return new ZodObject(def);
}
const ZodUnion = /*@__PURE__*/ $constructor("ZodUnion", (inst, def) => {
	$ZodUnion.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => unionProcessor(inst, ctx, json, params);
	inst.options = def.options;
});
function union(options, params) {
	return new ZodUnion({
		type: "union",
		options,
		...normalizeParams(params)
	});
}
const ZodDiscriminatedUnion = /*@__PURE__*/ $constructor("ZodDiscriminatedUnion", (inst, def) => {
	ZodUnion.init(inst, def);
	$ZodDiscriminatedUnion.init(inst, def);
});
function discriminatedUnion(discriminator, options, params) {
	return new ZodDiscriminatedUnion({
		type: "union",
		options,
		discriminator,
		...normalizeParams(params)
	});
}
const ZodIntersection = /*@__PURE__*/ $constructor("ZodIntersection", (inst, def) => {
	$ZodIntersection.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => intersectionProcessor(inst, ctx, json, params);
});
function intersection(left, right) {
	return new ZodIntersection({
		type: "intersection",
		left,
		right
	});
}
const ZodRecord = /*@__PURE__*/ $constructor("ZodRecord", (inst, def) => {
	_ensureDefaultMemoizer();
	$ZodRecord.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => recordProcessor(inst, ctx, json, params);
	inst.keyType = def.keyType;
	inst.valueType = def.valueType;
});
function record(keyType, valueType, params) {
	if (!valueType || !valueType._zod) return new ZodRecord({
		type: "record",
		keyType: string(),
		valueType: keyType,
		...normalizeParams(valueType)
	});
	return new ZodRecord({
		type: "record",
		keyType,
		valueType,
		...normalizeParams(params)
	});
}
const ZodEnum = /*@__PURE__*/ $constructor("ZodEnum", (inst, def) => {
	$ZodEnum.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => enumProcessor(inst, ctx, json, params);
	inst.enum = def.entries;
	inst.options = [...inst._zod.values];
	const keys = new Set(Object.keys(def.entries));
	inst.extract = (values, params) => {
		const newEntries = {};
		for (const value of values) if (keys.has(value)) newEntries[value] = def.entries[value];
		else throw new Error(`Key ${value} not found in enum`);
		return new ZodEnum({
			...def,
			checks: [],
			...normalizeParams(params),
			entries: newEntries
		});
	};
	inst.exclude = (values, params) => {
		const newEntries = { ...def.entries };
		for (const value of values) if (keys.has(value)) delete newEntries[value];
		else throw new Error(`Key ${value} not found in enum`);
		return new ZodEnum({
			...def,
			checks: [],
			...normalizeParams(params),
			entries: newEntries
		});
	};
});
function _enum(values, params) {
	const entries = Array.isArray(values) ? Object.fromEntries(values.map((v) => [v, v])) : values;
	return new ZodEnum({
		type: "enum",
		entries,
		...normalizeParams(params)
	});
}
const ZodLiteral = /*@__PURE__*/ $constructor("ZodLiteral", (inst, def) => {
	$ZodLiteral.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => literalProcessor(inst, ctx, json, params);
	inst.values = new Set(def.values);
	Object.defineProperty(inst, "value", { get() {
		if (def.values.length > 1) throw new Error("This schema contains multiple valid literal values. Use `.values` instead.");
		return def.values[0];
	} });
});
function literal(value, params) {
	return new ZodLiteral({
		type: "literal",
		values: Array.isArray(value) ? value : [value],
		...normalizeParams(params)
	});
}
const ZodTransform = /*@__PURE__*/ $constructor("ZodTransform", (inst, def) => {
	_ensureDefaultMemoizer();
	$ZodTransform.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => transformProcessor(inst, ctx, json, params);
	inst._zod.parse = (payload, _ctx) => {
		if (_ctx.direction === "backward") throw new $ZodEncodeError(inst.constructor.name);
		payload.addIssue = (issue$1) => {
			if (typeof issue$1 === "string") payload.issues.push(issue(issue$1, payload.value, def));
			else {
				const _issue = issue$1;
				if (_issue.fatal) _issue.continue = false;
				_issue.code ?? (_issue.code = "custom");
				if (!("input" in _issue)) _issue.input = payload.value;
				_issue.inst ?? (_issue.inst = inst);
				payload.issues.push(issue(_issue));
			}
		};
		const output = def.transform(payload.value, payload);
		if (output instanceof Promise) return output.then((output) => {
			payload.value = output;
			return payload;
		});
		payload.value = output;
		return payload;
	};
});
function transform(fn) {
	return new ZodTransform({
		type: "transform",
		transform: fn
	});
}
const ZodOptional = /*@__PURE__*/ $constructor("ZodOptional", (inst, def) => {
	$ZodOptional.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
});
function optional(innerType) {
	return new ZodOptional({
		type: "optional",
		innerType
	});
}
const ZodExactOptional = /*@__PURE__*/ $constructor("ZodExactOptional", (inst, def) => {
	$ZodExactOptional.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
});
function exactOptional(innerType) {
	return new ZodExactOptional({
		type: "optional",
		innerType
	});
}
const ZodNullable = /*@__PURE__*/ $constructor("ZodNullable", (inst, def) => {
	$ZodNullable.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => nullableProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
});
function nullable(innerType) {
	return new ZodNullable({
		type: "nullable",
		innerType
	});
}
const ZodDefault = /*@__PURE__*/ $constructor("ZodDefault", (inst, def) => {
	$ZodDefault.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => defaultProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
	inst.removeDefault = inst.unwrap;
});
function _default(innerType, defaultValue) {
	return new ZodDefault({
		type: "default",
		innerType,
		get defaultValue() {
			return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
		}
	});
}
const ZodPrefault = /*@__PURE__*/ $constructor("ZodPrefault", (inst, def) => {
	$ZodPrefault.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => prefaultProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
});
function prefault(innerType, defaultValue) {
	return new ZodPrefault({
		type: "prefault",
		innerType,
		get defaultValue() {
			return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
		}
	});
}
const ZodNonOptional = /*@__PURE__*/ $constructor("ZodNonOptional", (inst, def) => {
	$ZodNonOptional.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => nonoptionalProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
});
function nonoptional(innerType, params) {
	return new ZodNonOptional({
		type: "nonoptional",
		innerType,
		...normalizeParams(params)
	});
}
const ZodCatch = /*@__PURE__*/ $constructor("ZodCatch", (inst, def) => {
	$ZodCatch.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => catchProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
	inst.removeCatch = inst.unwrap;
});
function _catch(innerType, catchValue) {
	return new ZodCatch({
		type: "catch",
		innerType,
		catchValue: typeof catchValue === "function" ? catchValue : constantCatch(catchValue)
	});
}
const ZodPipe = /*@__PURE__*/ $constructor("ZodPipe", (inst, def) => {
	$ZodPipe.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => pipeProcessor(inst, ctx, json, params);
	inst.in = def.in;
	inst.out = def.out;
});
function pipe(in_, out) {
	return new ZodPipe({
		type: "pipe",
		in: in_,
		out
	});
}
const ZodReadonly = /*@__PURE__*/ $constructor("ZodReadonly", (inst, def) => {
	$ZodReadonly.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => readonlyProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
});
function readonly(innerType) {
	return new ZodReadonly({
		type: "readonly",
		innerType
	});
}
const ZodCustom = /*@__PURE__*/ $constructor("ZodCustom", (inst, def) => {
	$ZodCustom.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => customProcessor(inst, ctx, json, params);
});
function refine(fn, _params = {}) {
	return /* @__PURE__ */ _refine(ZodCustom, fn, _params);
}
function superRefine(fn, params) {
	return /* @__PURE__ */ _superRefine(fn, params);
}
//#endregion
//#region ../../node_modules/.pnpm/zod@4.6.7/node_modules/zod/v4/classic/iso.js
function datetime(params) {
	return /* @__PURE__ */ _isoDateTime(ZodISODateTime, params);
}
//#endregion
//#region ../protocol/dist/facts.js
/** ISO time, with Z or an offset. */
const Time = datetime({ offset: true });
/** Tool-specific detail that views never rely on. */
const Extra = record(string(), unknown()).optional();
const SourceSchema = _enum(["claude-code"]);
/** A project: one code repository, by its id (see projectId) and a short name. */
const ProjectSchema = object({
	id: string().min(1),
	name: string().min(1)
});
/**
* Where a file or a command lands when it isn't in the session's own project (#74): `project` is
* the repo it is in, and `away` is true when that repo is outside the session's folder, so the
* agent is working away from home; a repo inside the folder (a workspace above several repos) has
* `project` and no `away`. Both absent: the session's own project, as for a peer that predates
* them. A data layer sends them only to a server that said it reads them (`welcome`), and only for
* a project the server's office holds; anything else stays on the machine.
*/
const Elsewhere = {
	project: ProjectSchema.optional(),
	away: boolean().optional()
};
const SessionFactSchema = object({
	id: string().min(1),
	source: SourceSchema,
	lead: string().min(1),
	title: string().nullable(),
	titleFrom: _enum(["source", "branch"]),
	branch: string().nullable(),
	checkout: string().optional(),
	lastActive: Time,
	status: _enum(["active", "idle"]),
	lights: _enum(["on", "off"]),
	contextWindow: number().int().positive().optional(),
	takesMessages: literal(true).optional(),
	extra: Extra
});
const TokenCount = number().int().nonnegative();
/** The longest workflow description. */
const MAX_WORKFLOW_DESCRIPTION_LENGTH = 1e3;
const TokenCounts = object({
	input: TokenCount,
	cacheWrite: TokenCount,
	cacheWrite1h: TokenCount,
	cacheRead: TokenCount,
	output: TokenCount
});
const AgentFactSchema = object({
	id: string().min(1),
	source: SourceSchema,
	session: string().min(1),
	startedBy: string().min(1).nullable(),
	agentType: string().nullable(),
	task: string().nullable(),
	status: _enum([
		"working",
		"idle",
		"done",
		"stalled",
		"stopped",
		"failed"
	]),
	statusSince: Time,
	lastActive: Time,
	doing: object({
		kind: _enum([
			"write",
			"read",
			"run",
			"search",
			"talk"
		]),
		file: string().optional(),
		since: Time,
		...Elsewhere
	}).nullable(),
	usage: TokenCounts.extend({
		model: string().min(1),
		context: TokenCount,
		over100k: TokenCounts,
		at: Time
	}).nullable(),
	checkout: string().optional(),
	branch: string().nullable().optional(),
	checkIns: array(object({
		with: string().min(1),
		kind: _enum(["talk", "read"]),
		since: Time
	})).max(20).optional(),
	workflow: object({
		id: string().min(1),
		phase: string().max(100),
		label: string().max(200)
	}).optional(),
	extra: Extra
});
/**
* A Claude Code workflow run (the Workflow tool, also used by ultracode): `id` is its run id, so a
* new run is a new workflow and an ended one doesn't change again. `startedBy` is the agent whose
* Workflow call started it. Its agents are AgentFacts with `workflow.id` naming it; at most
* MAX_WORKFLOW_AGENTS of them are sent, and `moreAgents` counts the rest. `status`: running while
* it writes, stalled once it has been quiet a while and idle after longer, with no end record;
* done, stopped or failed once it ended. `usage.tokens`: its tokens, counted by Claude Code when it
* ended, summed over its agents before. A data layer cuts each text to its MAX_* limit.
*/
const WorkflowFactSchema = object({
	id: string().min(1),
	session: string().min(1),
	startedBy: string().min(1),
	name: string().min(1).max(200),
	description: string().max(MAX_WORKFLOW_DESCRIPTION_LENGTH).optional(),
	phases: array(object({
		title: string().max(100),
		detail: string().max(500).optional()
	})).max(30),
	status: _enum([
		"running",
		"stalled",
		"idle",
		"done",
		"stopped",
		"failed"
	]),
	startedAt: Time,
	endedAt: Time.optional(),
	usage: object({ tokens: TokenCount }).optional(),
	moreAgents: number().int().positive().optional(),
	extra: Extra
});
/**
* An edit or a read: `file` is relative to its repo's root, with forward slashes. One is known by
* its agent, file and project, so one agent's README.md at home and in another repo are two.
*/
const FileFactSchema = object({
	agent: string().min(1),
	file: string().min(1),
	at: Time,
	...Elsewhere,
	extra: Extra
});
const WaitFactSchema = object({
	waiter: string().min(1),
	on: string().min(1),
	since: Time,
	extra: Extra
});
/**
* An agent's final report. One the secret scan matched, and its owner hasn't released, is
* `withheld`: its `text` then only says so, and the report follows once the owner releases it by
* `withheld.id`, a random id for this one text. A newer report of the same agent gets a new id.
*/
const ReportFactSchema = object({
	agent: string().min(1),
	at: Time,
	text: string(),
	withheld: object({ id: string().min(1) }).optional(),
	extra: Extra
});
/**
* A question an agent asked its owner, open until it is answered, so the floor can show it and the
* owner can answer it there. One of the named cases of session-derived text leaving a machine: the
* server keeps it only for the retention period. `id` is the tool call's own id. `answerable`: the
* session's own plugin is waiting for it, so an answer from the floor reaches it; without it (a
* session seen only through the wake hook, a question asked before the plugin loaded) the floor
* shows the question read-only. `withheld`: the secret scan matched its text, or the patterns
* couldn't be read, so `questions` is only a placeholder; it is answered in the terminal.
*/
const QuestionFactSchema = object({
	id: string().min(1),
	agent: string().min(1),
	at: Time,
	questions: array(object({
		question: string().min(1),
		header: string(),
		options: array(object({
			label: string().min(1),
			description: string()
		})),
		multiSelect: boolean()
	})).min(1),
	answerable: literal(true).optional(),
	withheld: literal(true).optional(),
	extra: Extra
});
const FactsSchema = object({
	session: SessionFactSchema,
	agents: array(AgentFactSchema),
	edits: array(FileFactSchema),
	reads: array(FileFactSchema),
	waits: array(WaitFactSchema),
	reports: array(ReportFactSchema),
	/** Absent from a data layer that doesn't report questions, which is the same as none. */
	questions: array(QuestionFactSchema).optional(),
	/** Absent from a data layer that doesn't report workflows, which is the same as none. */
	workflows: array(WorkflowFactSchema).optional()
});
/** The records that changed, each replacing the one with the same key. */
const FactUpsertSchema = object({
	session: SessionFactSchema.optional(),
	agents: array(AgentFactSchema).optional(),
	edits: array(FileFactSchema).optional(),
	reads: array(FileFactSchema).optional(),
	waits: array(WaitFactSchema).optional(),
	reports: array(ReportFactSchema).optional(),
	questions: array(QuestionFactSchema).optional(),
	workflows: array(WorkflowFactSchema).optional()
});
const FileKey = FileFactSchema.pick({
	agent: true,
	file: true,
	project: true
});
/**
* The keys of records that went away: an agent by its id, an edit or read by agent, file and
* project (absent for the session's own), a
* wait by waiter and on, a report by its agent, a question or a workflow by its id. The session itself goes with
* the connection. `questionOutcomes`: how each question in `questions` ended, by its id: `answered`,
* in the terminal or from the floor, or `abandoned`, with no answer (interrupted, or a new prompt
* came first). Absent, or without a question's id, from a peer that doesn't say (protocol 0.3.5 on).
*/
const FactRemoveSchema = object({
	agents: array(string().min(1)).optional(),
	edits: array(FileKey).optional(),
	reads: array(FileKey).optional(),
	waits: array(WaitFactSchema.pick({
		waiter: true,
		on: true
	})).optional(),
	reports: array(string().min(1)).optional(),
	questions: array(string().min(1)).optional(),
	questionOutcomes: record(string().min(1), _enum(["answered", "abandoned"])).optional(),
	workflows: array(string().min(1)).optional()
});
const Version = literal(1);
const Seq = number().int().nonnegative();
const Account = object({
	id: string().min(1),
	name: string()
});
const Machine = object({ name: string().min(1) });
/** Matches a request with its reply or refusal. */
const RequestId = string().min(1);
/** A handoff's id. It names the handoff's branch, `isoplan/handoff/<id>`, so it keeps to safe characters. */
const HandoffId = string().max(64).regex(/^[a-z0-9][a-z0-9-]*$/, "lowercase letters, digits and dashes");
/**
* Whether a path segment is one Windows reads as `.git`: the name before any NTFS stream
* (`.git::$INDEX_ALLOCATION`), its trailing dots and spaces dropped, in any case, or the 8.3 short
* name of a folder that starts with `.git`.
*/
const isGitFolder = (segment) => {
	const name = segment.split(":")[0].replace(/[. ]+$/, "").toLowerCase();
	return name === ".git" || /^git~\d+$/.test(name);
};
/**
* One repo a handoff pushed: its path in the session's folder (`.` for the folder itself), remote,
* branch and commit. A handoff drives git on the receiver's machine, so the path stays inside the
* folder, out of any `.git` folder (in any spelling Windows reads as one: `.GIT.`, `.git `, `GIT~1`),
* with no `:` (an NTFS stream, such as `.git::$INDEX_ALLOCATION`), and the remote can't name a transport helper such as `ext::`, which runs a command.
*/
const HandoffRepoSchema = object({
	path: string().min(1).refine((path) => !/^([\\/]|[A-Za-z]:)/.test(path), "a path relative to the session's folder").refine((path) => !path.split(/[\\/]/).includes(".."), "a path inside the session's folder, with no `..`").refine((path) => !path.startsWith("-"), "a path that doesn't start with `-`, which git would read as an option").refine((path) => !path.split(/[\\/]/).some(isGitFolder), "a path that isn't in a `.git` folder").refine((path) => !path.includes(":"), "a path with no `:`, which Windows reads as a drive or a file's stream").refine((path) => path === "." || !path.split(/[\\/]/).some((part) => part === "" || part === "." || part === ".."), "`.` itself, or a path of named folders, with no empty, `.` or `..` part"),
	remote: string().min(1).refine((remote) => !/^[A-Za-z0-9+.-]+::/.test(remote), "a remote with no transport helper (`<transport>::`)").refine((remote) => !remote.startsWith("-"), "a remote that doesn't start with `-`, which git would read as an option"),
	branch: string().min(1),
	commit: string().regex(/^([0-9a-f]{40}|[0-9a-f]{64})$/, "a full commit hash")
});
/** A spin-off's task: what the new session is to do, as the person handing over typed it. */
const Task = string().trim().min(1).max(4e3);
/**
* What the receiver gets: the brief, and every repo pushed for it, each on the handoff's own branch,
* `isoplan/handoff/<id>`. Repos that push to the same remote can't share one, so each after the
* first has `isoplan/handoff/<id>--<its path, as lowercase letters, digits and dashes>`.
* `task` (protocol 0.10.0): the handoff is a spin-off, a new task of its own for the new session,
* and the brief is written for that task; without it, the new session carries on this work.
*/
const HandoffSchema = object({
	id: HandoffId,
	brief: string().min(1),
	repos: array(HandoffRepoSchema).min(1),
	task: Task.optional()
}).superRefine((handoff, context) => {
	handoff.repos.forEach((repo, i) => {
		const own = `isoplan/handoff/${handoff.id}`;
		if (repo.branch !== own && !(repo.branch.startsWith(`${own}--`) && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(repo.branch.slice(own.length + 2)))) context.addIssue({
			code: "custom",
			path: [
				"repos",
				i,
				"branch"
			],
			message: `the handoff's branch, isoplan/handoff/${handoff.id} or isoplan/handoff/${handoff.id}--<slug>`
		});
	});
});
/**
* The machine's access token from pairing, which an office server that signs people in requires.
* It refuses a hello without one as `not-paired`, an expired or unknown one as `token-expired`, one
* whose pairing was revoked or has lapsed as `pairing-ended`, and one for a session another paired
* machine reports as `forged-hello`. A server that signs nobody in ignores it.
*/
const Token = string().min(1).max(200).optional();
/** The longest instruction a person may send a driven session, a start's first one included. */
const MAX_INSTRUCTION_LENGTH = 2e4;
/** The longest agent reply a `driven` reply carries; a longer one is cut to fit and marked `cut`. */
const MAX_REPLY_LENGTH = 2e4;
/** The longest full output a `driven` output carries; a longer one is cut to fit and marked `cut`. */
const MAX_OUTPUT_LENGTH = 2e5;
/** The longest description of what a permission prompt asks to do. */
const MAX_PROMPT_LENGTH = 2e3;
/** The longest error text or refusal detail. */
const MAX_DETAIL_LENGTH = 1e3;
/** The longest folder a `handed-back`, a `folders` or a start names. */
const MAX_FOLDER_LENGTH = 4096;
/** The longest sign-in link a `driven` `claude` carries. */
const MAX_SIGN_IN_URL_LENGTH = 4e3;
/**
* Claude Code for the terminal on the runner's machine (protocol 0.7.0, #180), as the runner finds
* it the way it finds it for driven sessions: `ready`, found and signed in, or found with a sign-in
* `claude auth status` couldn't say; `signed-out`, found, and `claude auth status` says it isn't
* signed in; `missing`, no claude binary found.
*/
const ClaudeCliSchema = _enum([
	"ready",
	"signed-out",
	"missing"
]);
/** A drive request's, an instruction's, a prompt's or a withheld text's id. */
const DriveId = string().min(1).max(100);
/** A driven session, by its id as its facts name it (`claude-code:<uuid>`). */
const DrivenSessionId = string().min(1).max(200);
/** A room on the floor, by the server's id for it. */
const Room = string().min(1).max(200);
const Instruction = string().trim().min(1).max(MAX_INSTRUCTION_LENGTH);
const ToolName = string().min(1).max(100);
const Detail = string().min(1).max(MAX_DETAIL_LENGTH);
/** A folder on the runner's machine, as the runner names it. */
const Folder = string().min(1).max(MAX_FOLDER_LENGTH);
/** A branch on a repo's remote, by its name under `refs/heads/`. */
const BranchName = string().min(1).max(255);
/** The text was longer than its field's limit, so the runner cut it to fit. */
const Cut = literal(true).optional();
/** The secret scan matched the text: it only says so, and its owner can release it by this id (drive `release`). */
const Withheld = object({ id: DriveId }).optional();
/**
* The permission mode a driven session runs in: Claude Code's `auto`, the default, or
* `bypassPermissions`, which skips its permission prompts, for a person who opted in, and only in a
* project whose office allows it (`drive-policy`).
*/
const DrivePermissionsSchema = _enum(["auto", "bypassPermissions"]);
/** Where a new session from the floor opens other than run from the floor (protocol 0.10.0): a start's `mode`, as a take's. */
const StartModeSchema = _enum([
	"terminal",
	"headless",
	"orca",
	"desktop"
]);
/** The first message on a connection: who is reporting, from where, about which session. */
const HelloMessageSchema = object({
	type: literal("hello"),
	v: Version,
	source: SourceSchema,
	account: Account,
	machine: Machine,
	session: string().min(1),
	project: ProjectSchema,
	token: Token
});
/**
* The first message on a runner's link: the one link per machine that answers requests for its rooms.
* `orca`: Orca's CLI is on this machine, so a handoff can be taken into Orca (mode `orca`).
* `desktop` (protocol 0.4.0): Claude Code for the terminal, new enough to hand a session to the Claude
* app, is on this machine, a Mac or Windows x64, so a handoff can be opened in the Claude app (mode `desktop`).
* `drive` (protocol 0.5.0): this runner drives sessions from the floor: it takes `drive` requests and
* `drive-policy`, sends `driven` messages, and takes a handoff as a driven session (mode `driven`). The
* server sends none of these to a runner that didn't say it. A machine with no claude binary still says
* it, and refuses each start `no-claude`.
* `claude` (protocol 0.7.0, #180): Claude Code for the terminal on this machine (ClaudeCli), which
* driven sessions, a take into a terminal and a headless one all need. A runner that says it says it
* on every hello, says `driven` `claude` whenever it changes, and takes the `install-claude` and
* `sign-in-claude` drive requests; the server sends neither to a runner that didn't say it.
* `starts` (protocol 0.10.0, isoplan-plugin#85): the places other than the floor a new session from
* the floor can open in on this machine, the start's `mode`: `terminal` and `headless` where this
* runner can open them, and `orca` and `desktop` only where `orca` and `desktop` are said. The server
* sends a start with a `mode` only to a runner that says `starts`, and only one of its places: a
* runner from before 0.10.0 drops the field it doesn't know and would run the session from the floor.
*/
const RunnerHelloMessageSchema = object({
	type: literal("runner"),
	v: Version,
	account: Account,
	machine: Machine,
	token: Token,
	orca: boolean().optional(),
	desktop: boolean().optional(),
	drive: boolean().optional(),
	claude: ClaudeCliSchema.optional(),
	starts: array(StartModeSchema).max(4).optional()
});
/** All of the session's facts. Sent on connect and on repair. */
const FullMessageSchema = object({
	type: literal("full"),
	v: Version,
	seq: Seq,
	facts: FactsSchema
});
/** What changed since the last message. `seq` goes up by one per message, so a gap shows. */
const ChangesMessageSchema = object({
	type: literal("changes"),
	v: Version,
	seq: Seq,
	upsert: FactUpsertSchema,
	remove: FactRemoveSchema
});
/** The longest message an owner sends their open session from the floor (protocol 0.8.0 on). */
const MAX_OWNER_MESSAGE_LENGTH = 2e4;
/**
* Why an owner-message didn't reach its session (protocol 0.8.0 on), on its `unavailable` refusal:
* `not-owner`, it came from someone other than the session's owner; `detached`, the session is seen
* only through the wake hook, with no plugin in it to pass the message on; `no-submit`, its Claude
* Code build can't take a message from a plugin; `ended`, the session has ended or moved on (a
* /clear); `dropped`, Claude Code didn't let the message in (a hook or its own limits); `no-answer`,
* the plugin in the session never said whether it took the message (the session may have closed).
*/
const OwnerMessageRefusalSchema = _enum([
	"not-owner",
	"detached",
	"no-submit",
	"ended",
	"dropped",
	"no-answer"
]);
/** A cap on the answers a machine gives: a room's per hour, the owner's per day, or the owner's tokens per day. */
const CapSchema = _enum([
	"room-hour",
	"owner-day",
	"owner-tokens"
]);
/** The answer to a request, carrying the request's id and kind. */
const ReplyMessageSchema = discriminatedUnion("kind", [
	object({
		type: literal("reply"),
		v: Version,
		id: RequestId,
		kind: literal("answer-question"),
		answer: string().min(1)
	}),
	object({
		type: literal("reply"),
		v: Version,
		id: RequestId,
		kind: literal("write-brief"),
		handoff: HandoffSchema,
		fallback: literal(true).optional(),
		cap: CapSchema.optional(),
		noClaude: literal(true).optional()
	}),
	object({
		type: literal("reply"),
		v: Version,
		id: RequestId,
		kind: literal("owner-answer"),
		closed: literal(true).optional(),
		late: literal(true).optional()
	}),
	object({
		type: literal("reply"),
		v: Version,
		id: RequestId,
		kind: literal("owner-message"),
		queued: literal(true).optional()
	}),
	object({
		type: literal("reply"),
		v: Version,
		id: RequestId,
		kind: literal("focus")
	})
]);
/**
* A request the machine won't answer, sent in place of its reply. `over-cap` names the cap it would
* go over. `withheld` means the secret scan matched; the reply follows if the owner releases it.
* `unavailable` is anything else that stops the room answering now, such as its checkout being gone,
* its lead being mid-turn or a push being rejected.
*/
const RefusalMessageSchema = discriminatedUnion("reason", [
	object({
		type: literal("refusal"),
		v: Version,
		id: RequestId,
		reason: literal("over-cap"),
		cap: CapSchema
	}),
	object({
		type: literal("refusal"),
		v: Version,
		id: RequestId,
		reason: literal("withheld"),
		file: string().min(1).optional(),
		held: number().int().positive().optional(),
		unchecked: array(string().min(1)).optional()
	}),
	object({
		type: literal("refusal"),
		v: Version,
		id: RequestId,
		reason: literal("unavailable"),
		detail: string().min(1),
		code: OwnerMessageRefusalSchema.optional()
	})
]);
/**
* The sender's session handed its room over with the command: its agent wrote the brief and pushed.
* `to` is the receiver as the sender named them, for the server to find in the office.
*/
const HandOverMessageSchema = object({
	type: literal("hand-over"),
	v: Version,
	to: string().min(1),
	handoff: HandoffSchema
});
/**
* The sender's session asks, before it pushes, whether a hand-over with this id to `to` would be
* taken: the server answers hand-over-ready, or an error saying why not. `task` (protocol 0.10.0):
* the hand-over will be a spin-off with this task, the same as its handoff's `task`.
*/
const HandOverCheckMessageSchema = object({
	type: literal("hand-over-check"),
	v: Version,
	to: string().min(1),
	handoff: HandoffId,
	task: Task.optional()
});
/** The receiver's session asks for the handoff a take code stands for. */
const TakeMessageSchema = object({
	type: literal("take"),
	v: Version,
	code: string().min(1)
});
/**
* The receiver took the handoff and joins its room. Each step that failed is listed with the repo it
* was for and the end of its output; a failed setup step doesn't stop the session opening. From a runner, `session` is the
* session it opened, which joins the room; without one no session opened (no clone to work in, or
* no terminal), so the handoff is still there to take. From a session, the session itself joins.
* `clone` is a missing repo under the folder whose git clone failed.
*/
const TakenMessageSchema = object({
	type: literal("taken"),
	v: Version,
	handoff: HandoffId,
	session: string().min(1).optional(),
	failures: array(object({
		step: _enum([
			"worktree",
			"clone",
			"setup",
			"checkout",
			"open"
		]),
		repo: string().min(1).optional(),
		output: string()
	}))
});
/**
* The receiver's session asks the room it was handed a question (#49), on its own short link with
* the session's hello: the room's lead, on its owner's machine, answers it. The server answers
* `asked`, or an error (`ask-refused`) when the session may not ask. `key`, the asking side's own id
* for this ask, makes a retry of it the same question rather than a second one.
*/
const AskRoomMessageSchema = object({
	type: literal("ask-room"),
	v: Version,
	question: string().trim().min(1).max(4e3),
	key: string().min(1).max(100).optional()
});
/** The asking session polls a question it asked: the server answers `asked`. */
const AskCheckMessageSchema = object({
	type: literal("ask-check"),
	v: Version,
	question: RequestId
});
/**
* The asking session's agent was shown how a question ended (answered or dropped): the server stops
* sending it again.
*/
const AskedAckMessageSchema = object({
	type: literal("asked-ack"),
	v: Version,
	question: RequestId
});
const driven = {
	type: literal("driven"),
	v: Version
};
/**
* Why a runner won't do what a `drive` request asked, sent in place of its answer (protocol 0.5.0).
* `not-owner`: the acting person isn't the session's owner, this runner's person. `not-found`: this
* machine has no driven session by that id that it would act on, or, for a release, holds nothing
* withheld under that id (it was dropped, or the runner restarted since). `bypass-off`: the start asked for
* `bypassPermissions` in a project whose office doesn't allow it (`drive-policy`). `no-folder`: this
* machine has no folder for the room's project, or a start named a folder it didn't list in `folders` for that project, or that is no longer in it, or a branch it didn't list for it. `no-claude`: it has no claude binary. `busy`: the
* session can't take this now, such as while a turn runs, or an install or sign-in of Claude Code runs already. `no-prompt`: an answer names a prompt the
* session isn't waiting on (never raised by this runner, answered already, timed out or cancelled).
* `cap-reached`: the project already has `limit` driven sessions running on this machine.
* `unavailable` is anything else, saying what in `detail`. A runner never refuses `offline`: that is
* the server's own (FloorDriveRefusalReason).
*/
const DrivenRefusedSchema = discriminatedUnion("reason", [
	object({
		...driven,
		kind: literal("refused"),
		id: DriveId,
		reason: _enum([
			"not-owner",
			"not-found",
			"bypass-off",
			"no-folder",
			"no-claude",
			"busy",
			"no-prompt"
		]),
		detail: Detail.optional()
	}),
	object({
		...driven,
		kind: literal("refused"),
		id: DriveId,
		reason: literal("cap-reached"),
		limit: number().int().positive(),
		detail: Detail.optional()
	}),
	object({
		...driven,
		kind: literal("refused"),
		id: DriveId,
		reason: literal("unavailable"),
		detail: Detail
	})
]);
discriminatedUnion("type", [
	HelloMessageSchema,
	RunnerHelloMessageSchema,
	FullMessageSchema,
	ChangesMessageSchema,
	ReplyMessageSchema,
	RefusalMessageSchema,
	HandOverMessageSchema,
	HandOverCheckMessageSchema,
	TakeMessageSchema,
	TakenMessageSchema,
	AskRoomMessageSchema,
	AskCheckMessageSchema,
	AskedAckMessageSchema,
	discriminatedUnion("kind", [
		object({
			...driven,
			kind: literal("started"),
			id: DriveId,
			session: DrivenSessionId,
			room: Room,
			permissions: DrivePermissionsSchema
		}),
		object({
			...driven,
			kind: literal("turn-started"),
			session: DrivenSessionId,
			turn: DriveId
		}),
		object({
			...driven,
			kind: literal("tool"),
			session: DrivenSessionId,
			turn: DriveId,
			tool: ToolName,
			summary: string().min(1).max(500).optional(),
			withheld: literal(true).optional()
		}).superRefine((message, context) => {
			if (message.withheld && message.summary !== void 0) context.addIssue({
				code: "custom",
				path: ["summary"],
				message: "no summary when the secret scan withheld it"
			});
		}),
		object({
			...driven,
			kind: literal("reply"),
			session: DrivenSessionId,
			turn: DriveId,
			text: string().min(1).max(MAX_REPLY_LENGTH),
			cut: Cut,
			withheld: Withheld
		}),
		object({
			...driven,
			kind: literal("turn-ended"),
			session: DrivenSessionId,
			turn: DriveId,
			outcome: _enum([
				"done",
				"failed",
				"stopped"
			])
		}),
		object({
			...driven,
			kind: literal("opened"),
			id: DriveId,
			session: DrivenSessionId,
			room: Room,
			mode: StartModeSchema,
			note: Detail.optional()
		}),
		object({
			...driven,
			kind: literal("error"),
			session: DrivenSessionId,
			turn: DriveId.optional(),
			text: Detail
		}),
		object({
			...driven,
			kind: literal("output"),
			id: DriveId,
			session: DrivenSessionId,
			turn: DriveId.optional(),
			text: string().max(MAX_OUTPUT_LENGTH),
			cut: Cut,
			withheld: Withheld
		}),
		object({
			...driven,
			kind: literal("prompt"),
			session: DrivenSessionId,
			turn: DriveId.optional(),
			prompt: DriveId,
			tool: ToolName,
			description: string().min(1).max(MAX_PROMPT_LENGTH),
			withheld: literal(true).optional(),
			expires: datetime({ offset: true })
		}),
		object({
			...driven,
			kind: literal("prompt-ended"),
			session: DrivenSessionId,
			prompt: DriveId,
			outcome: _enum([
				"allowed",
				"denied",
				"timed-out",
				"cancelled"
			]),
			id: DriveId.optional()
		}),
		object({
			...driven,
			kind: literal("held"),
			session: DrivenSessionId,
			room: Room,
			why: _enum([
				"started",
				"reopened",
				"restored"
			]),
			permissions: DrivePermissionsSchema
		}),
		object({
			...driven,
			kind: literal("released"),
			session: DrivenSessionId,
			why: _enum([
				"stopped",
				"handed-back",
				"idle-closed",
				"crashed"
			]),
			id: DriveId.optional()
		}),
		object({
			...driven,
			kind: literal("handed-back"),
			id: DriveId,
			session: DrivenSessionId,
			command: string().min(1).max(500),
			folder: Folder
		}),
		DrivenRefusedSchema,
		object({
			...driven,
			kind: literal("claude"),
			claude: ClaudeCliSchema,
			doing: _enum(["installing", "signing-in"]).optional(),
			progress: Detail.optional(),
			url: url({ protocol: /^https$/ }).max(MAX_SIGN_IN_URL_LENGTH).optional(),
			failed: Detail.optional(),
			id: DriveId.optional()
		}),
		object({
			...driven,
			kind: literal("holding"),
			sessions: array(object({
				session: DrivenSessionId,
				room: Room,
				held: boolean(),
				permissions: DrivePermissionsSchema,
				turn: DriveId.optional()
			})).max(200)
		}),
		object({
			...driven,
			kind: literal("folders"),
			repos: array(object({
				project: string().min(1),
				folders: array(Folder).min(1).max(5),
				branches: array(BranchName).max(100).optional()
			})).max(100)
		})
	])
]);
/** Asks the data layer to send its facts in full. */
const RepairMessageSchema = object({
	type: literal("repair"),
	v: Version,
	reason: string().optional()
});
/** A note for the later editor of `file`, which the data layer adds to `agent`'s next tool result. */
const ConflictMessageSchema = object({
	type: literal("conflict"),
	v: Version,
	agent: string().min(1),
	file: string().min(1),
	text: string().min(1)
});
/**
* Sent after a hello is let in, by a server that reads where an edit or command lands (#74): the
* projects of the session's office it may report work in, lower-cased: every one with a remote, and
* of those with none (`local:`), only the hello's own machine's. A data layer reports a file,
* command or worktree outside the session's own project only for one of these, and one that hasn't
* had a welcome on its connection keeps them on the machine, as an older server would read them as
* the session's own.
*/
const WelcomeMessageSchema = object({
	type: literal("welcome"),
	v: Version,
	projects: array(string().min(1))
});
/** Something the data layer should show. */
const ErrorMessageSchema = object({
	type: literal("error"),
	v: Version,
	code: string().min(1),
	message: string()
});
/**
* Something for the machine to answer, with a reply or a refusal carrying the same id. `session` is
* the session it concerns: the lead whose fork answers or writes the brief, or the session whose
* agent asked its owner. `room` is the room the caps count against.
*/
const RequestMessageSchema = discriminatedUnion("kind", [
	object({
		type: literal("request"),
		v: Version,
		id: RequestId,
		kind: literal("answer-question"),
		session: string().min(1),
		room: string().min(1),
		from: Account,
		question: string().min(1)
	}),
	object({
		type: literal("request"),
		v: Version,
		id: RequestId,
		kind: literal("write-brief"),
		session: string().min(1),
		room: string().min(1),
		handoff: HandoffId,
		to: Account,
		task: Task.optional()
	}),
	object({
		type: literal("request"),
		v: Version,
		id: RequestId,
		kind: literal("owner-answer"),
		session: string().min(1),
		question: string().min(1),
		answers: record(string(), string())
	}),
	object({
		type: literal("request"),
		v: Version,
		id: RequestId,
		kind: literal("owner-message"),
		session: string().min(1),
		from: Account,
		text: string().trim().min(1).max(MAX_OWNER_MESSAGE_LENGTH)
	}),
	object({
		type: literal("request"),
		v: Version,
		id: RequestId,
		kind: literal("focus"),
		handoff: HandoffId
	})
]);
/**
* The request is over (its handoff was cancelled, dismissed or replaced): the machine drops what it
* holds for it, and doesn't send or push what it was still writing. From protocol 0.4.0 `id` may be
* a take's session id, to a runner taking a handoff from the floor that was cancelled or timed out:
* the take opens nothing more (a take into the Claude app doesn't open the app).
*/
const DropMessageSchema = object({
	type: literal("drop"),
	v: Version,
	id: RequestId
});
/**
* The owner released what the secret scan withheld, so the machine sends it now. On the runner's
* link `id` is the request whose reply was withheld; on a session's link it is the withheld
* report's `withheld.id`, and only that exact report is released.
*/
const ReleaseMessageSchema = object({
	type: literal("release"),
	v: Version,
	id: RequestId
});
/**
* A handoff for the receiver to take: sent to their runner when they take it from the floor, or to
* their session in answer to a take code.
*/
const HandoffMessageSchema = object({
	type: literal("handoff"),
	v: Version,
	handoff: HandoffSchema,
	mode: _enum([
		"terminal",
		"headless",
		"orca",
		"desktop",
		"driven"
	]).optional(),
	session: string().uuid().optional(),
	by: Account.optional(),
	room: Room.optional(),
	permissions: DrivePermissionsSchema.optional()
}).superRefine((message, context) => {
	if (message.mode !== "driven") return;
	for (const key of [
		"session",
		"by",
		"room",
		"permissions"
	]) if (message[key] === void 0) context.addIssue({
		code: "custom",
		path: [key],
		message: "required for a take as a driven session"
	});
});
/** A hand-over-check passed: `to` is the receiver the server found for the name given. */
const HandOverReadyMessageSchema = object({
	type: literal("hand-over-ready"),
	v: Version,
	handoff: HandoffId,
	to: Account
});
/** The sender's hand-over reached the room: `to` is the receiver the server found for the name given. */
const HandedOverMessageSchema = object({
	type: literal("handed-over"),
	v: Version,
	handoff: HandoffId,
	to: Account
});
/**
* Where a question asked of the room stands (#49), sent in answer to ask-room and ask-check, and
* down the asking session's own link when an answer arrives after it stopped polling. `queued`: the
* owner's machine can't answer now (it is off, its runner is away, a cap is reached, or the fork
* couldn't answer), and it is asked again later; `note` says why. `asking`: the owner's runner is
* answering. `withheld`: the answer matched a secret pattern on the owner's machine, which keeps it
* until they release it. `answered`, with `answer`. `dropped`: it won't be answered (the owner
* turned asking off, the handoff was dismissed, or it ran out of tries or time); `note` says why.
* `text` is the question as it was asked, `owner` the name of the person whose session answers, and
* `key` the ask's own key.
* An answered or dropped question is sent again down the session's own link until it is acked.
*/
const AskedMessageSchema = object({
	type: literal("asked"),
	v: Version,
	question: RequestId,
	text: string().min(1),
	state: _enum([
		"queued",
		"asking",
		"withheld",
		"answered",
		"dropped"
	]),
	answer: string().min(1).optional(),
	note: string().min(1).optional(),
	owner: string().optional(),
	/** The `key` the question was asked under, so the asking side knows which of its asks it was. */
	key: string().min(1).max(100).optional()
});
/**
* Whether this session may ask `room` now (#49), sent down its own link when it connects in a room
* that was handed to its person, and whenever that changes: a take grants it, and the owner can
* turn it off and on again.
*/
const AskRightsMessageSchema = object({
	type: literal("ask-rights"),
	v: Version,
	room: string().min(1),
	owner: Account,
	granted: boolean()
});
const drive = {
	type: literal("drive"),
	v: Version,
	id: DriveId,
	by: Account
};
discriminatedUnion("type", [
	RepairMessageSchema,
	WelcomeMessageSchema,
	ConflictMessageSchema,
	ErrorMessageSchema,
	RequestMessageSchema,
	ReleaseMessageSchema,
	HandoffMessageSchema,
	HandedOverMessageSchema,
	HandOverReadyMessageSchema,
	DropMessageSchema,
	AskedMessageSchema,
	AskRightsMessageSchema,
	discriminatedUnion("kind", [
		object({
			...drive,
			kind: literal("start"),
			room: Room.optional(),
			folder: Folder.optional(),
			branch: BranchName.optional(),
			project: ProjectSchema,
			roomSessions: array(DrivenSessionId).max(20).optional(),
			instruction: Instruction.optional(),
			permissions: DrivePermissionsSchema,
			mode: _enum([
				"terminal",
				"headless",
				"orca",
				"desktop",
				"driven"
			]).optional()
		}).superRefine((message, context) => {
			if (message.mode !== void 0 && message.mode !== "driven") {
				if (message.folder === void 0) context.addIssue({
					code: "custom",
					path: ["folder"],
					message: "a start that opens outside the floor names a folder"
				});
				if (message.instruction === void 0) context.addIssue({
					code: "custom",
					path: ["instruction"],
					message: "a start that opens outside the floor names its first instruction"
				});
			}
			if (message.folder === void 0) {
				if (message.room === void 0) context.addIssue({
					code: "custom",
					path: ["room"],
					message: "a start names a room, or a folder"
				});
				if (message.branch !== void 0) context.addIssue({
					code: "custom",
					path: ["branch"],
					message: "a start names a branch only with a folder"
				});
				return;
			}
			for (const key of ["room", "roomSessions"]) if (message[key] !== void 0) context.addIssue({
				code: "custom",
				path: [key],
				message: "a start in a folder opens a new room, with nothing from another"
			});
		}),
		object({
			...drive,
			kind: literal("instruct"),
			session: DrivenSessionId,
			text: Instruction
		}),
		object({
			...drive,
			kind: literal("stop"),
			session: DrivenSessionId
		}),
		object({
			...drive,
			kind: literal("hand-back"),
			session: DrivenSessionId
		}),
		object({
			...drive,
			kind: literal("output"),
			session: DrivenSessionId,
			turn: DriveId.optional()
		}),
		object({
			...drive,
			kind: literal("answer"),
			session: DrivenSessionId,
			prompt: DriveId,
			answer: _enum(["allow", "deny"])
		}),
		object({
			...drive,
			kind: literal("release"),
			session: DrivenSessionId,
			withheld: DriveId
		}),
		object({
			...drive,
			kind: literal("install-claude")
		}),
		object({
			...drive,
			kind: literal("sign-in-claude")
		})
	]),
	object({
		type: literal("drive-policy"),
		v: Version,
		bypassAllowed: array(string().min(1)).max(1e3)
	})
]);
//#endregion
//#region src/connect/dialog.ts
const exec = (file, args, env) => new Promise((resolve) => {
	let stdout = "";
	const child = spawn(file, args, {
		windowsHide: true,
		stdio: [
			"ignore",
			"pipe",
			"ignore"
		],
		env: env ? {
			...process.env,
			...env
		} : process.env
	});
	child.stdout.on("data", (chunk) => stdout += String(chunk));
	child.on("error", () => resolve({
		code: null,
		stdout
	}));
	child.on("close", (code) => resolve({
		code,
		stdout
	}));
});
[
	"$ErrorActionPreference = 'Stop'",
	"Add-Type -AssemblyName System.Windows.Forms, System.Drawing",
	...[`Add-Type -Namespace IsoplanWin -Name User32 -MemberDefinition '[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);'`, "$first = New-Object System.Windows.Forms.Form; [void][IsoplanWin.User32]::ShowWindow($first.Handle, 0); $first.Dispose()"],
	"[System.Windows.Forms.Application]::EnableVisualStyles()",
	"$f = New-Object System.Windows.Forms.Form",
	"$f.Text = $env:ISOPLAN_DIALOG_TITLE",
	"$f.FormBorderStyle = 'FixedDialog'; $f.MaximizeBox = $false; $f.MinimizeBox = $false; $f.StartPosition = 'CenterScreen'; $f.TopMost = $true",
	"$f.AutoSize = $true; $f.AutoSizeMode = 'GrowAndShrink'; $f.Padding = New-Object System.Windows.Forms.Padding 16",
	"$layout = New-Object System.Windows.Forms.FlowLayoutPanel; $layout.FlowDirection = 'TopDown'; $layout.AutoSize = $true; $layout.AutoSizeMode = 'GrowAndShrink'",
	"$label = New-Object System.Windows.Forms.Label; $label.Text = $env:ISOPLAN_DIALOG_TEXT; $label.UseMnemonic = $false; $label.AutoSize = $true; $label.MaximumSize = New-Object System.Drawing.Size 480, 0",
	"$row = New-Object System.Windows.Forms.FlowLayoutPanel; $row.FlowDirection = 'RightToLeft'; $row.AutoSize = $true; $row.Anchor = 'Right'",
	"$cancel = New-Object System.Windows.Forms.Button; $cancel.Text = 'Cancel'; $cancel.UseMnemonic = $false; $cancel.AutoSize = $true; $cancel.DialogResult = 'Cancel'",
	"$connect = New-Object System.Windows.Forms.Button; $connect.Text = 'Connect'; $connect.UseMnemonic = $false; $connect.AutoSize = $true; $connect.DialogResult = 'OK'",
	"$row.Controls.AddRange(@($cancel, $connect)); $layout.Controls.AddRange(@($label, $row)); $f.Controls.Add($layout)",
	"$f.AcceptButton = $cancel; $f.CancelButton = $cancel",
	`$timer = New-Object System.Windows.Forms.Timer; $timer.Interval = 300000; $timer.Add_Tick({ $f.DialogResult = 'Cancel'; $f.Close() })`,
	"$f.Add_Shown({ $f.Activate(); $cancel.Focus(); $timer.Start() })",
	"$r = $f.ShowDialog(); $timer.Stop()",
	"if ($r -eq [System.Windows.Forms.DialogResult]::OK) { exit 0 } else { exit 2 }"
].join("\n");
//#endregion
//#region src/data-layer/config.ts
async function loadConfig(io, defaultsPath, userPath) {
	const config = await loadSettings(io, defaultsPath, userPath);
	const asked = (await readJson$1(io, userPath, true)).server;
	if (typeof asked === "string" && URL.canParse(asked) && new URL(asked).protocol === "ws:" && !LOOPBACK.has(new URL(asked).hostname)) {
		if (config.allowPlainWs) config.server = asked;
		else config.plainRefused = asked;
	}
	return config;
}
/** The same per-key override for any settings file of the mod's, such as the runner's runner.json. */
async function loadSettings(io, defaultsPath, userPath) {
	const defaults = await readJson$1(io, defaultsPath);
	const user = await readJson$1(io, userPath, true);
	const config = {};
	for (const [key, fallback] of Object.entries(defaults)) config[key] = fits(key, user[key], fallback) ? user[key] : fallback;
	return config;
}
const BYTE_KEYS = /* @__PURE__ */ new Set(["tailBytes"]);
const FLOORS = /* @__PURE__ */ new Map([["streamSeconds", .25]]);
const ZERO_OFF = /* @__PURE__ */ new Set(["lightsOffHours", "updateCheckHours"]);
function fits(key, value, fallback) {
	if (key === "server") return typeof value === "string" && isWebSocketUrl(value);
	if (typeof fallback === "number") {
		if (BYTE_KEYS.has(key)) return Number.isSafeInteger(value) && value > 0;
		if (ZERO_OFF.has(key) && value === 0) return true;
		return typeof value === "number" && Number.isFinite(value) && value > 0 && value >= (FLOORS.get(key) ?? 0);
	}
	if (Array.isArray(fallback)) return Array.isArray(value);
	return value != null && typeof value === typeof fallback;
}
const LOOPBACK = /* @__PURE__ */ new Set([
	"127.0.0.1",
	"[::1]",
	"localhost"
]);
function isWebSocketUrl(value) {
	if (!URL.canParse(value)) return false;
	const url = new URL(value);
	return url.protocol === "wss:" || url.protocol === "ws:" && LOOPBACK.has(url.hostname);
}
async function readJson$1(io, p, optional = false) {
	if (optional && !await io.stat(p)) return {};
	try {
		const value = JSON.parse(await io.read(p));
		return value && typeof value === "object" && !Array.isArray(value) ? value : {};
	} catch (err) {
		if (optional) return {};
		throw err;
	}
}
//#endregion
//#region src/data-layer/io.ts
function nodeIo({ run = runCommand } = {}) {
	return {
		run,
		async listDir(dir) {
			try {
				return (await fs.readdir(dir, { withFileTypes: true })).map((e) => ({
					name: e.name,
					isDir: e.isDirectory()
				}));
			} catch {
				return [];
			}
		},
		async stat(p) {
			try {
				const s = await fs.stat(p);
				return {
					isDir: s.isDirectory(),
					mtimeMs: s.mtimeMs,
					size: s.size
				};
			} catch {
				return null;
			}
		},
		realpath: (p) => fs.realpath(p),
		isDirSync: (p) => {
			try {
				return statSync(p).isDirectory();
			} catch {
				return false;
			}
		},
		async read(p, start, end) {
			if (start === void 0 || end === void 0) return fs.readFile(p, "utf8");
			const fh = await fs.open(p, "r");
			try {
				const buf = Buffer.alloc(Math.max(0, end - start));
				const { bytesRead } = await fh.read(buf, 0, buf.length, start);
				return buf.subarray(0, bytesRead).toString("utf8");
			} finally {
				await fh.close();
			}
		}
	};
}
function runCommand([cmd, ...args], { cwd }) {
	return new Promise((resolve) => {
		execFile(cmd, args, {
			cwd,
			encoding: "utf8",
			timeout: 1e4,
			windowsHide: true
		}, (err, stdout) => {
			resolve({
				code: err ? typeof err.code === "number" ? err.code : 1 : 0,
				stdout: stdout || ""
			});
		});
	});
}
//#endregion
//#region src/wake/lock.ts
async function readText(file) {
	try {
		const [text, st] = await Promise.all([fs.readFile(file, "utf8"), fs.stat(file)]);
		return {
			text,
			mtimeMs: st.mtimeMs
		};
	} catch {
		return null;
	}
}
function parseLock(text, mtimeMs) {
	try {
		const { pid, until, ...extra } = JSON.parse(text);
		return {
			pid: Number.isSafeInteger(pid) && pid > 0 ? pid : null,
			until: typeof until === "number" ? until : null,
			mtimeMs,
			extra
		};
	} catch {
		return null;
	}
}
async function readLock(file) {
	const r = await readText(file);
	return r && parseLock(r.text, r.mtimeMs);
}
/** The pid the lock names, or null when there is none or it can't be read. */
async function lockHolder(file) {
	return (await readLock(file))?.pid ?? null;
}
const held = (lock, now, { isAlive = alive, freshMs }) => !!lock && (lock.until !== null && lock.until > now || lock.pid !== null && isAlive(lock.pid) && (freshMs === void 0 || now - lock.mtimeMs < freshMs));
/**
* Takes the lock for `pid`; false when it is held (`isHeld`). With `force` (the plugin's data
* layer) it is taken regardless: the runner holding it sees that and steps aside. `extra` is
* written into the lock beside the pid.
*
* A new lock is created exclusively, so of two takers at once only one gets it. A stale one is
* moved aside by rename, which only one taker can do to the same file, and the taker checks that
* what it moved is the lock it judged stale, by its text and its write time, so a lock its holder
* refreshed meanwhile isn't taken: one that moved another's lock instead puts it back and loses.
* With `force` a lock that can't be moved (on Windows a scanner may have it open) is tried again
* after a short wait, then overwritten, so the plugin's data layer always gets it.
*/
async function takeLock(file, pid, isAlive = alive, force = false, now = Date.now(), { freshMs, extra = {} } = {}) {
	await fs.mkdir(path.dirname(file), { recursive: true });
	const body = JSON.stringify({
		pid,
		...extra
	});
	for (let tries = 0; tries < 5; tries++) {
		if (tries && force) await new Promise((r) => setTimeout(r, 20 * tries));
		try {
			await fs.writeFile(file, body, { flag: "wx" });
			return true;
		} catch (err) {
			if (err.code !== "EEXIST") throw err;
		}
		const seen = await readText(file);
		if (!seen) continue;
		const lock = parseLock(seen.text, seen.mtimeMs);
		if (!force && lock?.pid !== pid && held(lock, now, {
			isAlive,
			freshMs
		})) return false;
		const aside = `${file}.${pid}-${Math.random().toString(36).slice(2)}`;
		try {
			await fs.rename(file, aside);
		} catch (err) {
			if ([
				"ENOENT",
				"EPERM",
				"EBUSY",
				"EACCES"
			].includes(err.code ?? "")) continue;
			throw err;
		}
		const moved = await fs.readFile(aside, "utf8").catch(() => null);
		const movedAt = (await fs.stat(aside).catch(() => null))?.mtimeMs;
		if (moved !== seen.text || movedAt !== seen.mtimeMs) {
			await fs.link(aside, file).catch(() => {});
			await fs.rm(aside, { force: true });
			if (!force) return false;
			continue;
		}
		await fs.rm(aside, { force: true });
	}
	if (!force) return false;
	await fs.writeFile(file, body);
	return true;
}
/** Removes the lock if it still names `pid`. */
async function releaseLock(file, pid) {
	if (await lockHolder(file) === pid) await fs.rm(file, { force: true });
}
/** Turns the lock `pid` holds into a hold-off until `until`, with `extra` beside it; one another has taken is left. */
async function holdOff(file, pid, until, extra = {}) {
	if (await lockHolder(file) === pid) await fs.writeFile(file, JSON.stringify({
		pid: 0,
		until,
		...extra
	}));
}
function alive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		return err.code === "EPERM";
	}
}
//#endregion
//#region src/wake/wake.ts
const wakeRecordPath = (claudeDir) => path.join(claudeDir, "isoplan", "wake.json");
//#endregion
//#region src/runner/environment.ts
const runnerEnvPath = (claudeDir) => path.join(claudeDir, "isoplan", "runner", "environment.json");
/** The recorded environment, or null when there is none, or it doesn't parse, so the starter's is used. */
async function recordedEnv(claudeDir) {
	try {
		const { env } = JSON.parse(await fs.readFile(runnerEnvPath(claudeDir), "utf8"));
		if (!env || typeof env !== "object" || Array.isArray(env)) return null;
		return Object.fromEntries(Object.entries(env).filter((e) => typeof e[1] === "string"));
	} catch {
		return null;
	}
}
//#endregion
//#region src/runner/start.ts
/** The runner's lock: `{ pid, code }` of the supervisor that holds it. */
const runnerLockPath = (claudeDir) => path.join(claudeDir, "isoplan", "runner", "lock.json");
/** What names a runner.js's code: its size and write time. Null when it is gone. */
async function runnerCode(file) {
	const st = await fs.stat(file).catch(() => null);
	return st && st.isFile() ? `${st.size}-${Math.round(st.mtimeMs)}` : null;
}
/** The live runner's lock: a hold-off that hasn't ended, or a live pid that keeps it fresh. */
async function liveRunner(claudeDir, now, isAlive) {
	const lock = await readLock(runnerLockPath(claudeDir));
	if (!lock) return null;
	if (lock.until !== null && lock.until > now) return {
		...lock,
		isHoldOff: true
	};
	if (lock.pid !== null && isAlive(lock.pid) && now - lock.mtimeMs < 9e4) return {
		...lock,
		isHoldOff: false
	};
	return null;
}
const desktopAppPath = (claudeDir) => path.join(claudeDir, "isoplan", "runner", "desktop-app.json");
/** The desktop app install recorded, if its program is still there. */
async function recordedApp(claudeDir) {
	try {
		const app = JSON.parse(await fs.readFile(desktopAppPath(claudeDir), "utf8"));
		if (typeof app.version !== "string" || typeof app.dir !== "string" || typeof app.launch !== "string") return null;
		return (await fs.stat(app.launch).catch(() => null))?.isFile() ? app : null;
	} catch {
		return null;
	}
}
/** The lock's holder is the desktop app. */
const isAppLock = (extra) => extra.engine === "app";
/**
* How the desktop app is started for `claudeDir` with no window and no focus. Electrobun's launcher
* doesn't pass its arguments on to the app (seen on Windows), so a config folder other than
* ~/.claude goes in CLAUDE_CONFIG_DIR, as Claude Code reads it; ~/.claude takes it out. On macOS
* through `open -g`, so it starts as an app of its own and stays in the background; `--env` only
* when the folder isn't ~/.claude.
*/
function appCommand(app, claudeDir, platform, env, home) {
	const isDefault = path.resolve(claudeDir) === path.resolve(home, ".claude");
	const { CLAUDE_CONFIG_DIR: _, ...rest } = env;
	const appEnv = isDefault ? rest : {
		...rest,
		CLAUDE_CONFIG_DIR: claudeDir
	};
	if (platform === "darwin") return {
		file: "/usr/bin/open",
		args: [
			"-g",
			...isDefault ? [] : ["--env", `CLAUDE_CONFIG_DIR=${claudeDir}`],
			app.dir
		],
		env: appEnv
	};
	return {
		file: app.launch,
		args: [],
		env: appEnv
	};
}
/** Starts the desktop app (appCommand), and doesn't wait for it. */
function openApp(app, claudeDir) {
	const { file, args, env } = appCommand(app, claudeDir, process.platform, process.env, os.homedir());
	spawn(file, args, {
		cwd: claudeDir,
		env,
		detached: true,
		stdio: "ignore",
		windowsHide: true
	}).on("error", () => {}).unref();
}
/**
* Starts the recorded runner unless a live one runs the recorded code. One on older code is
* replaced. A hold-off keeps it from starting, except a crash loop's hold-off on older code: a new
* version may have fixed what crashed. With the desktop app recorded it opens the app instead,
* once no node runner runs, and a live app is running.
*/
async function startRunner({ claudeDir, spawn, isAlive = alive, kill = (pid) => process.kill(pid), now = Date.now, open = openApp }) {
	let runner;
	try {
		runner = JSON.parse(await fs.readFile(wakeRecordPath(claudeDir), "utf8")).runner;
	} catch {
		return "not-installed";
	}
	if (typeof runner !== "string") return "not-installed";
	const code = await runnerCode(runner);
	if (!code) return "not-installed";
	const lockFile = runnerLockPath(claudeDir);
	const app = await recordedApp(claudeDir);
	const live = await liveRunner(claudeDir, now(), isAlive);
	if (live?.isHoldOff) {
		if (live.extra.reason !== "gave-up" || live.extra.code === code) return "held-off";
		if ((await readLock(lockFile))?.until === live.until) await fs.rm(lockFile, { force: true });
	} else if (live) {
		if (isAppLock(live.extra) || live.extra.code === code && !app) return "running";
		await stopRunner(claudeDir, {
			isAlive,
			kill,
			now,
			expect: {
				pid: live.pid,
				code: live.extra.code
			}
		});
	}
	if (app) {
		open(app, claudeDir);
		return "started";
	}
	const env = await recordedEnv(claudeDir);
	spawn([
		runner,
		"--claude-dir",
		claudeDir,
		...env ? [] : ["--inherited-env"]
	], claudeDir, env ?? void 0);
	return "started";
}
/**
* Ends the running runner, for uninstall and updates: its worker and forks follow once its
* supervisor has gone. True when one was running. A stale lock's pid is never killed. With
* `expect`, only the runner judged outdated is: if the lock names another pid or code by now
* (another starter replaced it already), it is left.
*/
async function stopRunner(claudeDir, { isAlive = alive, kill = (pid) => process.kill(pid), now = Date.now, expect } = {}) {
	const live = await liveRunner(claudeDir, now(), isAlive);
	if (!live || live.isHoldOff || live.pid === null) return false;
	if (expect && (live.pid !== expect.pid || live.extra.code !== expect.code)) return false;
	try {
		kill(live.pid);
	} catch {}
	await releaseLock(runnerLockPath(claudeDir), live.pid);
	return true;
}
//#endregion
//#region src/install/app.ts
const desktopAppLockPath = (claudeDir) => path.join(claudeDir, "isoplan", "runner", "desktop-app.lock");
/** Where the app goes for this person, the folder its archive holds at its top, and the program to start in it. */
function appPlace(platform, home, env) {
	if (platform === "win32") return {
		dir: path.win32.join(env.LOCALAPPDATA || path.win32.join(home, "AppData", "Local"), "Programs", "Isoplan"),
		top: "Isoplan"
	};
	if (platform === "darwin") return {
		dir: path.posix.join(home, "Applications", "Isoplan.app"),
		top: "Isoplan.app"
	};
	return null;
}
/** The program that starts the app: Electrobun's launcher on Windows, the bundle's executable on macOS. */
async function launchOf(dir, platform) {
	if (platform === "win32") return path.join(dir, "bin", "launcher.exe");
	const plist = await fs.readFile(path.join(dir, "Contents", "Info.plist"), "utf8");
	const name = /<key>CFBundleExecutable<\/key>\s*<string>([^<]+)<\/string>/.exec(plist)?.[1];
	if (!name) throw new Error("its Info.plist names no executable");
	return path.join(dir, "Contents", "MacOS", name);
}
/** The system's own tar, by its full path: another tar first on PATH (Git Bash's) misreads C:\ paths. */
const systemTar = (platform, env) => platform === "win32" ? path.win32.join(env.SystemRoot || "C:\\Windows", "System32", "tar.exe") : "/usr/bin/tar";
/**
* Puts the app this plugin version names in place, unless it is there already. Says what it
* changed, and, when nothing was installed, why the runner stays on node; `installed` is true when
* a new app is in place, for the caller to start it.
*/
async function installApp(o) {
	const { claudeDir, platform } = o;
	const now = o.now ?? Date.now;
	const isAlive = o.isAlive ?? alive;
	const settings = await loadSettings(nodeIo(), path.join(o.from, "runner.json"), path.join(claudeDir, "isoplan", "runner.json"));
	const recorded = await recordedApp(claudeDir);
	const place = appPlace(platform, o.home, o.env);
	const stay = (why) => ({
		changes: [`the runner stays on node: ${why}`],
		installed: false
	});
	if (!settings.desktopApp) {
		if (!recorded) return {
			changes: [],
			installed: false
		};
		await stopApp(o, isAlive, now);
		await fs.rm(desktopAppPath(claudeDir), { force: true });
		return {
			changes: ["took the desktop app out of use, as \"desktopApp\" is off in runner.json; the runner runs on node"],
			installed: false
		};
	}
	if (!place) return {
		changes: [],
		installed: false
	};
	const release = JSON.parse(await fs.readFile(path.join(o.from, "app-release.json"), "utf8"));
	if (recorded?.version === release.version && recorded.dir === place.dir) return {
		changes: [],
		installed: false
	};
	const lock = desktopAppLockPath(claudeDir);
	const downloadMs = settings.appDownloadSeconds * 1e3;
	if (!await takeLock(lock, process.pid, isAlive, false, now(), { freshMs: 2 * downloadMs + 6e4 })) return {
		changes: [],
		installed: false
	};
	const staging = `${place.dir}.isoplan-${process.pid}`;
	try {
		const manifestUrl = release.manifest.replace(/\{version\}/g, release.version);
		const got = await (o.fetch ?? fetch)(manifestUrl, { signal: AbortSignal.timeout(downloadMs) });
		if (!got.ok) throw new Error(`the release's manifest isn't there (${got.status} from ${manifestUrl})`);
		const manifest = await got.json();
		const key = `${platform}-${o.arch}`;
		const asset = manifest.assets?.[key];
		if (!asset) {
			await holdOff(lock, process.pid, now() + settings.appRetryHours * 36e5);
			return stay(`release ${release.version} has no desktop app for ${key}`);
		}
		await fs.rm(staging, {
			recursive: true,
			force: true
		});
		await fs.mkdir(staging, { recursive: true });
		const archive = path.join(staging, asset.file);
		await download(o.fetch ?? fetch, new URL(asset.file, manifestUrl).href, archive, asset, downloadMs);
		const unpacked = await (o.run ?? exec)(systemTar(platform, o.env), [
			"-xzf",
			archive,
			"-C",
			staging
		]);
		if (unpacked.code !== 0) throw new Error(`tar couldn't unpack ${asset.file} (${unpacked.code})`);
		const fresh = path.join(staging, place.top);
		const launch = await launchOf(fresh, platform);
		if (!(await fs.stat(launch).catch(() => null))?.isFile()) throw new Error(`${asset.file} holds no ${path.basename(launch)}`);
		await stopApp(o, isAlive, now);
		await swapIn(fresh, place.dir);
		const app = {
			version: release.version,
			dir: place.dir,
			launch: await launchOf(place.dir, platform)
		};
		await fs.writeFile(desktopAppPath(claudeDir), JSON.stringify(app, null, 2) + "\n");
		await releaseLock(lock, process.pid);
		return {
			changes: [`installed Isoplan's desktop app ${release.version} in ${place.dir}`],
			installed: true
		};
	} catch (err) {
		await holdOff(lock, process.pid, now() + settings.appRetryHours * 36e5).catch(() => {});
		return stay(`couldn't install the desktop app: ${err.message}; trying again in ${settings.appRetryHours} hours`);
	} finally {
		await fs.rm(staging, {
			recursive: true,
			force: true,
			maxRetries: 5
		}).catch(() => {});
	}
}
async function download(get, url, file, asset, timeoutMs) {
	const res = await get(url, { signal: AbortSignal.timeout(timeoutMs) });
	if (!res.ok || !res.body) throw new Error(`the download of ${asset.file} failed (${res.status})`);
	const hash = createHash("sha256");
	let size = 0;
	const body = Readable.fromWeb(res.body);
	body.on("data", (chunk) => {
		size += chunk.length;
		hash.update(chunk);
		if (size > asset.size) body.destroy(/* @__PURE__ */ new Error(`${asset.file} is bigger than the manifest says (${asset.size} bytes)`));
	});
	await pipeline(body, createWriteStream(file));
	if (size !== asset.size) throw new Error(`${asset.file} is ${size} bytes, not the ${asset.size} the manifest says`);
	if (hash.digest("hex") !== asset.sha256.toLowerCase()) throw new Error(`${asset.file}'s sha256 isn't the one the manifest says`);
}
async function swapIn(fresh, dir) {
	const old = `${dir}.old-${process.pid}`;
	let had = false;
	for (let tries = 0;; tries++) {
		const moved = await fs.rename(dir, old).then(() => null, (err) => err);
		if (!moved) had = true;
		else if (moved.code !== "ENOENT" && tries < 40) {
			await new Promise((r) => setTimeout(r, 250));
			continue;
		} else if (moved.code !== "ENOENT") throw new Error(`the installed app couldn't be moved aside (${moved.code}): is it still running?`);
		break;
	}
	try {
		await fs.mkdir(path.dirname(dir), { recursive: true });
		await fs.rename(fresh, dir);
	} catch (err) {
		if (had) await fs.rename(old, dir).catch(() => {});
		throw err;
	}
	if (had) await fs.rm(old, {
		recursive: true,
		force: true,
		maxRetries: 5
	}).catch(() => {});
}
async function stopApp(o, isAlive, now) {
	const lock = await readLock(runnerLockPath(o.claudeDir));
	if (!lock?.pid || !isAppLock(lock.extra)) return;
	const pid = lock.pid;
	await stopRunner(o.claudeDir, {
		isAlive,
		now,
		...o.kill && { kill: o.kill }
	});
	for (const until = now() + (o.exitMs ?? 1e4); isAlive(pid) && now() < until;) await new Promise((r) => setTimeout(r, 100));
}
//#endregion
//#region src/runner/claude-binary.ts
const claudeBinaryPath = (claudeDir) => path.join(claudeDir, "isoplan", "claude-binary.json");
const isFile = (p) => fs.stat(p).then((s) => s.isFile(), () => false);
/**
* The `claude` binary's path: PATH first, then where Claude Code's installers put it. On Windows
* an npm install leaves only a claude.cmd shim, which can't be run without a shell, so its cli.js
* is used instead (run with node). Null when none is found.
*/
async function findClaude(env, platform, home, exists = isFile) {
	const windows = platform === "win32";
	const join = windows ? path.win32.join : path.posix.join;
	const dirs = (Object.entries(env).find(([key]) => key.toUpperCase() === "PATH")?.[1] ?? "").split(windows ? ";" : ":").filter(Boolean);
	const candidates = windows ? [...dirs.map((d) => join(d, "claude.exe")), join(home, ".local", "bin", "claude.exe")] : [
		...dirs.map((d) => join(d, "claude")),
		join(home, ".local", "bin", "claude"),
		join(home, ".claude", "local", "claude"),
		"/opt/homebrew/bin/claude",
		"/usr/local/bin/claude"
	];
	for (const candidate of candidates) if (await exists(candidate)) return candidate;
	if (windows) for (const d of dirs) {
		const cli = join(d, "node_modules", "@anthropic-ai", "claude-code", "cli.js");
		if (await exists(join(d, "claude.cmd")) && await exists(cli)) return cli;
	}
	return null;
}
//#endregion
//#region src/install/hidden-launch.ts
/** wscript.exe, by its full path, so no other program of that name is found first. */
const wscriptPath = (env = process.env) => path.win32.join(env.SystemRoot || "C:\\Windows", "System32", "wscript.exe");
/** The command Windows runs: wscript in batch mode (no prompts, no logo), with the JScript engine, on `launcher`, then `args`. */
const launchCommand = (launcher, args = "") => `"${wscriptPath()}" //B //NoLogo //E:JScript "${launcher}"${args ? ` ${args}` : ""}`;
/** The launcher `launchCommand` names in a command; null for any other command. */
const launcherOf = (command) => command ? /^"[^"]+\\wscript\.exe" \/\/B \/\/NoLogo \/\/E:JScript "([^"]+)"/i.exec(command)?.[1] ?? null : null;
/** A literal JScript and JSON both read: JSON, with every character outside printable ASCII as \uXXXX. */
const asciiLiteral = (value) => JSON.stringify(value).replace(/[^\x20-\x7e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
/**
* The launcher: runs `"<node>" "<script>" <args>` hidden. With `link`, the link Windows gives it goes
* to node in ISOPLAN_CONNECT_URL, never on a command line, as the Mac handler passes it.
*/
function hiddenLauncher(node, script, { args = "", link = false } = {}) {
	const command = `"${node}" "${script}"${args ? ` ${args}` : ""}`;
	return [
		"// Isoplan: starts node with no window. The plugin's install wrote this file; uninstall removes it.",
		`var isoplan = ${asciiLiteral({
			node,
			script
		})};`,
		"var shell = new ActiveXObject(\"WScript.Shell\");",
		...link ? ["shell.Environment(\"PROCESS\")(\"ISOPLAN_CONNECT_URL\") = WScript.Arguments(0);"] : [],
		`shell.Run(${asciiLiteral(command)}, 0, false);`,
		""
	].join("\r\n");
}
/** The node and script a launcher names, as hiddenLauncher writes them; null when it isn't one. */
function launcherPaths(text) {
	const line = text ? /^var isoplan = (.*);\r?$/m.exec(text)?.[1] : void 0;
	try {
		return line ? JSON.parse(line) : null;
	} catch {
		return null;
	}
}
const SCRIPT_HOST_KEYS = ["HKCU\\Software\\Microsoft\\Windows Script Host\\Settings", "HKLM\\Software\\Microsoft\\Windows Script Host\\Settings"];
/** Whether Windows Script Host is turned off for this person or this computer (`Enabled` set to 0). */
async function scriptHostOff(run) {
	for (const key of SCRIPT_HOST_KEYS) {
		const value = /\bEnabled[ \t]+REG_\w+[ \t]+(\S+)/i.exec((await run("reg", [
			"query",
			key,
			"/v",
			"Enabled"
		])).stdout)?.[1];
		if (value !== void 0 && /^(0|0x0+)$/i.test(value)) return true;
	}
	return false;
}
//#endregion
//#region src/install/link-handler.ts
const KEY = "HKCU\\Software\\Classes\\isoplan";
const OPEN_KEY = `${KEY}\\shell\\open`;
const COMMAND_KEY = `${OPEN_KEY}\\command`;
const LSREGISTER = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";
const DESKTOP = "isoplan-connect.desktop";
const macAppPath = (claudeDir) => path.join(claudeDir, "isoplan", "Isoplan Connect.app");
const macMarker = (app) => path.join(app, "Contents", "Resources", "isoplan-handler.json");
const desktopPath = (h) => path.join(h.dataHome || path.join(h.home, ".local", "share"), "applications", DESKTOP);
/** The Windows launcher the open command runs. */
const linkLauncherPath = (claudeDir) => path.join(claudeDir, "isoplan", "open-link.js");
/** The Windows open command: wscript on the launcher, and the link. */
const windowsCommand = (launcher) => launchCommand(launcher, "\"%1\"");
/** The open command where Windows Script Host is off: node and the handler, quoted, and the link. */
const directCommand = (node, script) => `"${node}" "${script}" "%1"`;
/** The value `reg query` prints for a key's default or a named value, whatever the language of its "(Default)" label. */
const regValue = (stdout) => /REG_SZ[ \t]+(.*?)\s*$/m.exec(stdout)?.[1] ?? null;
const appleString = (text) => `"${text.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
/** The macOS app's script: the link to node in the background, quoted by the shell's own rules. */
const macScript = (node, script) => [
	"on open location theURL",
	`\tdo shell script "ISOPLAN_CONNECT_URL=" & quoted form of theURL & " " & quoted form of ${appleString(node)} & " " & quoted form of ${appleString(script)} & " >/dev/null 2>&1 &"`,
	"end open location",
	""
].join("\n");
const exists = (file) => fs.stat(file).then(() => true, () => false);
/** Whether a registration naming this node and this handler still works: both are there. */
const works = async (paths) => !!paths && typeof paths.node === "string" && typeof paths.script === "string" && await exists(paths.node) && await exists(paths.script);
/** The node and handler a direct Windows open command names, as directCommand writes it. */
const directPaths = (command) => {
	const m = command ? /^"([^"]+)" "([^"]+)" "%1"$/.exec(command) : null;
	return m ? {
		node: m[1],
		script: m[2]
	} : null;
};
/** A desktop entry's Exec argument, quoted as the Desktop Entry spec asks, then escaped as its strings are. */
const execArg = (value) => `"${value.replace(/(["`$\\])/g, "\\$1")}"`.replace(/\\/g, "\\\\");
/** The Linux desktop entry. */
const desktopEntry = (node, script) => [
	"[Desktop Entry]",
	"Type=Application",
	"Name=Isoplan Connect",
	`Exec=${execArg(node)} ${execArg(script)} %u`,
	"NoDisplay=true",
	"Terminal=false",
	"MimeType=x-scheme-handler/isoplan;",
	`X-Isoplan-Handler=${JSON.stringify({
		node,
		script
	})}`,
	""
].join("\n");
const desktopPaths = (entry) => {
	const line = entry ? /^X-Isoplan-Handler=(.*)$/m.exec(entry)?.[1] : void 0;
	try {
		return line ? JSON.parse(line) : null;
	} catch {
		return null;
	}
};
const linkHandlerLockPath = (claudeDir) => path.join(claudeDir, "isoplan", "link-handler.lock");
/** Registers the handler when none works; says what it changed. Another install registering at the same moment leaves it to that one. */
async function registerLinkHandler(given) {
	const lock = linkHandlerLockPath(given.claudeDir);
	if (!await takeLock(lock, process.pid, alive, false, Date.now(), { freshMs: 12e4 })) return [];
	try {
		return await register$1(given);
	} finally {
		await releaseLock(lock, process.pid).catch(() => {});
	}
}
async function register$1(given) {
	const h = {
		...given,
		node: await fs.realpath(given.node).catch(() => given.node)
	};
	const run = h.run ?? exec;
	const must = async (file, args) => {
		const r = await run(file, args);
		if (r.code !== 0) throw new Error(`${path.basename(file)} ${args[0] ?? ""} failed${r.code === null ? " to start" : ` (${r.code})`}`);
	};
	if (h.platform === "win32") {
		const current = regValue((await run("reg", [
			"query",
			COMMAND_KEY,
			"/ve"
		])).stdout);
		const off = await scriptHostOff(run);
		if (off && await works(directPaths(current))) return [];
		const launcher = launcherOf(current);
		if (!off && launcher && await works(launcherPaths(await fs.readFile(launcher, "utf8").catch(() => null)))) return [];
		const file = linkLauncherPath(h.claudeDir);
		if (!off) {
			await fs.mkdir(path.dirname(file), { recursive: true });
			await fs.writeFile(file, hiddenLauncher(h.node, h.script, { link: true }));
		}
		await must("reg", [
			"add",
			KEY,
			"/ve",
			"/d",
			"URL:Isoplan",
			"/f"
		]);
		await must("reg", [
			"add",
			KEY,
			"/v",
			"URL Protocol",
			"/d",
			"",
			"/f"
		]);
		await must("reg", [
			"add",
			OPEN_KEY,
			"/v",
			"FriendlyAppName",
			"/d",
			"Isoplan",
			"/f"
		]);
		await must("reg", [
			"add",
			COMMAND_KEY,
			"/ve",
			"/d",
			off ? directCommand(h.node, h.script) : windowsCommand(file),
			"/f"
		]);
		return [off ? `registered isoplan:// links to open ${h.script}; Windows Script Host is turned off, so a link shows a console window for a moment` : `registered isoplan:// links to open ${h.script}, through ${file}`];
	}
	if (h.platform === "darwin") {
		const app = macAppPath(h.claudeDir);
		const marker = JSON.stringify({
			node: h.node,
			script: h.script
		});
		const registered = await fs.readFile(macMarker(app), "utf8").then((t) => JSON.parse(t), () => null);
		if (await works(registered)) return [];
		const source = path.join(h.claudeDir, "isoplan", "connect.applescript");
		await fs.rm(app, {
			recursive: true,
			force: true
		});
		await fs.mkdir(path.dirname(source), { recursive: true });
		await fs.writeFile(source, macScript(h.node, h.script));
		try {
			await must("osacompile", [
				"-o",
				app,
				source
			]);
		} finally {
			await fs.rm(source, { force: true });
		}
		const plist = path.join(app, "Contents", "Info.plist");
		await must("plutil", [
			"-replace",
			"CFBundleIdentifier",
			"-string",
			"dev.isoplan.connect",
			plist
		]);
		await must("plutil", [
			"-replace",
			"CFBundleURLTypes",
			"-json",
			JSON.stringify([{
				CFBundleURLName: "Isoplan link",
				CFBundleURLSchemes: ["isoplan"]
			}]),
			plist
		]);
		await must("plutil", [
			"-replace",
			"LSUIElement",
			"-bool",
			"true",
			plist
		]);
		await must("codesign", [
			"--force",
			"--deep",
			"--sign",
			"-",
			app
		]);
		await fs.writeFile(macMarker(app), marker);
		await must(LSREGISTER, ["-f", app]);
		return [`registered isoplan:// links to open ${h.script}, through ${app}`];
	}
	if (h.platform === "linux") {
		const file = desktopPath(h);
		const want = desktopEntry(h.node, h.script);
		if ((await run("xdg-mime", [
			"query",
			"default",
			"x-scheme-handler/isoplan"
		])).stdout.trim() === DESKTOP && await works(desktopPaths(await fs.readFile(file, "utf8").catch(() => null)))) return [];
		await fs.mkdir(path.dirname(file), { recursive: true });
		await fs.writeFile(file, want);
		await must("xdg-mime", [
			"default",
			DESKTOP,
			"x-scheme-handler/isoplan"
		]);
		await run("update-desktop-database", [path.dirname(file)]);
		return [`registered isoplan:// links to open ${h.script}, through ${file}`];
	}
	return [];
}
//#endregion
//#region src/install/state.ts
/** Claude Code's plugins folder: $CLAUDE_CODE_PLUGIN_CACHE_DIR when it is set, else <claude dir>/plugins. */
const pluginsDir = (claudeDir, env) => env.CLAUDE_CODE_PLUGIN_CACHE_DIR || path.join(claudeDir, "plugins");
/** The folders $CLAUDE_CODE_PLUGIN_DIRS names. */
const pluginDirsOf = (env) => (env.CLAUDE_CODE_PLUGIN_DIRS ?? "").split(path.delimiter).filter(Boolean);
/** The system folder Claude Code reads managed-settings.json from. */
function managedDir(platform) {
	if (platform === "win32") return "C:\\Program Files\\ClaudeCode";
	if (platform === "darwin") return "/Library/Application Support/ClaudeCode";
	return "/etc/claude-code";
}
/** A path as compared: resolved, with forward slashes, and on Windows and macOS without regard to case. */
function normalPath(p, platform = process.platform) {
	const resolved = path.resolve(p).replace(/\\/g, "/");
	return platform === "win32" || platform === "darwin" ? resolved.toLowerCase() : resolved;
}
function cacheParts(cache, file) {
	const relative = path.relative(cache, path.resolve(file));
	if (path.isAbsolute(relative)) return null;
	const parts = relative.split(path.sep);
	return parts.length >= 4 && parts[0] !== ".." ? parts : null;
}
async function realCacheParts(plugins, file) {
	const cache = await fs.realpath(path.join(plugins, "cache")).catch(() => path.join(plugins, "cache"));
	return {
		cache,
		parts: cacheParts(cache, await fs.realpath(file).catch(() => file))
	};
}
const appliesTo = (install, project) => !project || !(install.scope === "project" || install.scope === "local") || !install.projectPath || normalPath(install.projectPath) === normalPath(project);
const KEY_FILES = [
	["dist", "data-layer.js"],
	["dist", "wake.js"],
	["dist", "hooks.js"],
	[".claude-plugin", "plugin.json"]
];
/**
* The data layer of the newest copy of its plugin Claude Code records for a session in `project`
* (`appliesTo`, as `pluginState` counts installs): by version when every one is x.y.z, else by
* which was updated last (`newestFirst`), counting only a folder that holds KEY_FILES and whose
* plugin.json names the recorded version (a plugin.json naming none counts, its version came from
* elsewhere). `dataLayer` itself when that copy is its own folder, when it is outside the cache, or
* when no record reads. A data layer this doesn't return is outdated: an update put another version
* on disk, which the session loads at its next start or /reload-plugins.
*/
async function newestDataLayer(plugins, dataLayer, project) {
	const { cache, parts } = await realCacheParts(plugins, dataLayer);
	if (!parts) return dataLayer;
	const id = `${parts[1]}@${parts[0]}`;
	const root = await realPath(path.join(cache, ...parts.slice(0, 3)));
	const recorded = newestFirst((await installs(plugins) ?? []).filter((i) => i.id === id && i.installPath && appliesTo(i, project)));
	for (const install of recorded) {
		if (await realPath(install.installPath) === root) return dataLayer;
		if (await isComplete(install)) return path.join(install.installPath, ...parts.slice(3));
	}
	return dataLayer;
}
/**
* Installs newest first, in one order for the whole list: by semantic version when every install's
* version is one (a pre-release below its release), else by `lastUpdated`, latest first.
*/
function newestFirst(list) {
	const versions = list.map((i) => semver(i.version));
	if (!versions.every(Boolean)) return [...list].sort((a, b) => (b.lastUpdated ?? "").localeCompare(a.lastUpdated ?? ""));
	return list.map((install, k) => ({
		install,
		v: versions[k]
	})).sort((a, b) => compareSemver(b.v, a.v)).map((x) => x.install);
}
const semver = (version) => {
	const m = version ? /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(version) : null;
	return m ? {
		core: [
			Number(m[1]),
			Number(m[2]),
			Number(m[3])
		],
		pre: m[4] ? m[4].split(".") : null
	} : null;
};
function compareSemver(a, b) {
	for (let i = 0; i < 3; i++) if (a.core[i] !== b.core[i]) return a.core[i] - b.core[i];
	if (!a.pre || !b.pre) return (a.pre ? -1 : 0) - (b.pre ? -1 : 0);
	for (let i = 0; i < Math.min(a.pre.length, b.pre.length); i++) {
		const [x, y] = [a.pre[i], b.pre[i]];
		if (x === y) continue;
		const [nx, ny] = [/^\d+$/.test(x), /^\d+$/.test(y)];
		if (nx && ny) return Number(x) - Number(y);
		if (nx !== ny) return nx ? -1 : 1;
		return x < y ? -1 : 1;
	}
	return a.pre.length - b.pre.length;
}
async function isComplete(install) {
	for (const file of KEY_FILES) if (!await fs.stat(path.join(install.installPath, ...file)).then((s) => s.isFile(), () => false)) return false;
	const manifest = await readJson(path.join(install.installPath, ".claude-plugin", "plugin.json"));
	return !!manifest && (typeof manifest.version !== "string" || manifest.version === install.version);
}
const realPath = async (p) => normalPath(await fs.realpath(p).catch(() => p));
const nameOf = (id) => id.slice(0, id.lastIndexOf("@"));
/** Every install installed_plugins.json records; null when it is missing, can't be read, or isn't the shape known. */
async function installs(plugins) {
	const record = await readJson(path.join(plugins, "installed_plugins.json"));
	const list = record?.plugins;
	if (record?.version !== 2 || !isObject(list) || !Object.values(list).every(Array.isArray)) return null;
	return Object.entries(list).flatMap(([id, entries]) => entries.map((entry) => {
		const e = isObject(entry) ? entry : {};
		const text = (key) => typeof e[key] === "string" ? e[key] : null;
		return {
			id,
			scope: text("scope"),
			projectPath: text("projectPath"),
			installPath: text("installPath"),
			version: text("version"),
			lastUpdated: text("lastUpdated")
		};
	}));
}
/** Whether `enabledPlugins` names the plugin `id` enabled, disabled, or not at all (null). */
async function enabledIn(file, id) {
	const value = (await readJson(file))?.enabledPlugins;
	return isObject(value) && typeof value[id] === "boolean" ? value[id] : null;
}
/**
* What Claude Code says of the plugin `dataLayer` belongs to. With `project` (a session's project
* folder) the project's settings and installs count too; without, only the machine's: the
* managed files, the user's settings, and every install.
*/
async function pluginState(place, dataLayer, project) {
	const { parts } = await realCacheParts(place.plugins, dataLayer);
	if (!parts) return "enabled";
	const id = `${parts[1]}@${parts[0]}`;
	const name = nameOf(id);
	const all = await installs(place.plugins);
	let ids = [id];
	if (all) {
		const mine = all.filter((i) => nameOf(i.id) === name);
		if (!mine.length) return await isInPluginDirs(place.pluginDirs ?? [], name) ? "enabled" : "uninstalled";
		const here = mine.filter((i) => appliesTo(i, project));
		if (!here.length) return "disabled";
		ids = [...new Set(here.map((i) => i.id))];
	}
	return (await Promise.all(ids.map((one) => enabledFor(place, one, project)))).includes(true) ? "enabled" : "disabled";
}
async function enabledFor(place, id, project) {
	const managed = await Promise.all((await managedFiles(place.managed)).map((file) => enabledIn(file, id)));
	if (managed.includes(false)) return false;
	if (managed.includes(true)) return true;
	for (const file of await ownFiles(place, project)) {
		const enabled = await enabledIn(file, id);
		if (enabled !== null) return enabled;
	}
	return true;
}
async function isInPluginDirs(dirs, name) {
	for (const dir of dirs) if ((await readJson(path.join(dir, ".claude-plugin", "plugin.json")))?.name === name) return true;
	return false;
}
async function managedFiles(managed) {
	const dropIns = await fs.readdir(path.join(managed, "managed-settings.d")).then((names) => names.filter((n) => n.endsWith(".json")).map((n) => path.join(managed, "managed-settings.d", n)), () => []);
	return [path.join(managed, "managed-settings.json"), ...dropIns];
}
async function ownFiles({ claudeDir }, project) {
	const files = [];
	if (project) {
		const root = await gitRoot(project);
		if (root && normalPath(root) !== normalPath(project)) files.push(path.join(root, ".claude", "settings.local.json"));
		files.push(path.join(project, ".claude", "settings.local.json"), path.join(project, ".claude", "settings.json"));
	}
	files.push(path.join(claudeDir, "settings.json"));
	return files;
}
async function gitRoot(dir) {
	for (let at = path.resolve(dir);; at = path.dirname(at)) {
		if (await fs.stat(path.join(at, ".git")).then(() => true, () => false)) return at;
		if (path.dirname(at) === at) return null;
	}
}
const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
async function readJson(file) {
	try {
		const value = JSON.parse((await fs.readFile(file, "utf8")).replace(/^\uFEFF/, ""));
		return isObject(value) ? value : null;
	} catch {
		return null;
	}
}
//#endregion
//#region src/install/login-item.ts
/** What the item passes the wake hook. */
const LOGIN_ARG = "--login";
const RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
/** A short id of the config folder, so each folder's item has its own name. */
const loginItemId = (claudeDir, platform) => createHash("sha256").update(normalPath(claudeDir, platform)).digest("hex").slice(0, 8);
const runValueName = (claudeDir) => `Isoplan runner ${loginItemId(claudeDir, "win32")}`;
const loginLauncherPath = (claudeDir) => path.join(claudeDir, "isoplan", "start-at-login.js");
const launchAgentLabel = (claudeDir) => `dev.isoplan.runner.${loginItemId(claudeDir, "darwin")}`;
const launchAgentPath = (home, claudeDir) => path.join(home, "Library", "LaunchAgents", `${launchAgentLabel(claudeDir)}.plist`);
const autostartPath = (h) => path.join(h.configHome || path.join(h.home, ".config"), "autostart", `isoplan-runner-${loginItemId(h.claudeDir, "linux")}.desktop`);
/** The Run value: wscript on the launcher. */
const windowsLoginCommand = (claudeDir) => launchCommand(loginLauncherPath(claudeDir));
const xml = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const unxml = (text) => text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
/**
* The LaunchAgent. AbandonProcessGroup, since launchd otherwise ends what is left in the job's
* process group once the job exits, and the job exits as soon as it has started the runner.
*/
const launchAgentPlist = (label, node, script) => [
	"<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
	"<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">",
	"<plist version=\"1.0\">",
	"<dict>",
	"	<key>Label</key>",
	`\t<string>${xml(label)}</string>`,
	"	<key>ProgramArguments</key>",
	"	<array>",
	...[
		node,
		script,
		LOGIN_ARG
	].map((arg) => `\t\t<string>${xml(arg)}</string>`),
	"	</array>",
	"	<key>RunAtLoad</key>",
	"	<true/>",
	"	<key>AbandonProcessGroup</key>",
	"	<true/>",
	"</dict>",
	"</plist>",
	""
].join("\n");
const plistPaths = (text) => {
	const args = text ? /<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(text)?.[1] : void 0;
	const [node, script] = args ? [...args.matchAll(/<string>([^<]*)<\/string>/g)].map((m) => unxml(m[1])) : [];
	return node && script ? {
		node,
		script
	} : null;
};
/** The XDG autostart entry. */
const autostartEntry = (node, script) => [
	"[Desktop Entry]",
	"Type=Application",
	"Name=Isoplan",
	"Comment=Starts Isoplan's runner when you log in",
	`Exec=${execArg(node)} ${execArg(script)} ${LOGIN_ARG}`,
	"Terminal=false",
	"NoDisplay=true",
	`X-Isoplan-Login=${JSON.stringify({
		node,
		script
	})}`,
	""
].join("\n");
const autostartPaths = (entry) => {
	const line = entry ? /^X-Isoplan-Login=(.*)$/m.exec(entry)?.[1] : void 0;
	try {
		return line ? JSON.parse(line) : null;
	} catch {
		return null;
	}
};
const read = (file) => fs.readFile(file, "utf8").catch(() => null);
/** Whether runner.json (`defaultsPath`, overridden by the person's `userPath`) has the runner start at login; on unless it says false. */
async function startsAtLogin(defaultsPath, userPath) {
	return (await loadSettings(nodeIo(), defaultsPath, userPath).catch(() => null))?.startAtLogin !== false;
}
const loginItemLockPath = (claudeDir) => path.join(claudeDir, "isoplan", "login-item.lock");
/** Registers the login item unless a working one is there; says what it changed. Another install registering at the same moment leaves it to that one. */
async function registerLoginItem(given) {
	const lock = loginItemLockPath(given.claudeDir);
	if (!await takeLock(lock, process.pid, alive, false, Date.now(), { freshMs: 12e4 })) return [];
	try {
		return await register(given);
	} finally {
		await releaseLock(lock, process.pid).catch(() => {});
	}
}
async function register(given) {
	const h = {
		...given,
		node: await fs.realpath(given.node).catch(() => given.node)
	};
	const run = h.run ?? exec;
	const must = async (file, args) => {
		const r = await run(file, args);
		if (r.code !== 0) throw new Error(`${path.basename(file)} ${args[0] ?? ""} failed${r.code === null ? " to start" : ` (${r.code})`}`);
	};
	if (h.platform === "win32") {
		if (await scriptHostOff(run)) {
			const why = "Windows Script Host is turned off on this computer, and without it the runner can't start with no window";
			const removed = await unregisterLoginItem(h);
			if (!removed.length) throw new Error(why);
			return removed.map((change) => `${change}: ${why}`);
		}
		const launcher = loginLauncherPath(h.claudeDir);
		const want = windowsLoginCommand(h.claudeDir);
		if (regValue((await run("reg", [
			"query",
			RUN_KEY,
			"/v",
			runValueName(h.claudeDir)
		])).stdout)?.toLowerCase() === want.toLowerCase() && await works(launcherPaths(await read(launcher)))) return [];
		await fs.mkdir(path.dirname(launcher), { recursive: true });
		await fs.writeFile(launcher, hiddenLauncher(h.node, h.script, { args: LOGIN_ARG }));
		await must("reg", [
			"add",
			RUN_KEY,
			"/v",
			runValueName(h.claudeDir),
			"/d",
			want,
			"/f"
		]);
		return [`set the runner to start at login, through ${launcher}`];
	}
	if (h.platform === "darwin") {
		const file = launchAgentPath(h.home, h.claudeDir);
		const label = launchAgentLabel(h.claudeDir);
		if (await works(plistPaths(await read(file)))) return [];
		await run("launchctl", ["bootout", `gui/${h.uid}/${label}`]);
		await fs.mkdir(path.dirname(file), { recursive: true });
		await fs.writeFile(file, launchAgentPlist(label, h.node, h.script));
		await must("launchctl", [
			"bootstrap",
			`gui/${h.uid}`,
			file
		]);
		return [`set the runner to start at login, through ${file}`];
	}
	if (h.platform === "linux") {
		const file = autostartPath(h);
		if (await works(autostartPaths(await read(file)))) return [];
		await fs.mkdir(path.dirname(file), { recursive: true });
		await fs.writeFile(file, autostartEntry(h.node, h.script));
		return [`set the runner to start at login, through ${file}`];
	}
	return [];
}
/** Takes this config folder's login item out; says what it changed. */
async function unregisterLoginItem(h) {
	const run = h.run ?? exec;
	const removed = (where) => [`took out the runner's start at login (${where})`];
	if (h.platform === "win32") {
		const name = runValueName(h.claudeDir);
		const had = (await run("reg", [
			"query",
			RUN_KEY,
			"/v",
			name
		])).code === 0;
		if (had) await run("reg", [
			"delete",
			RUN_KEY,
			"/v",
			name,
			"/f"
		]);
		const launcher = loginLauncherPath(h.claudeDir);
		const hadLauncher = !!await fs.stat(launcher).catch(() => null);
		await fs.rm(launcher, { force: true });
		return had || hadLauncher ? removed(`${RUN_KEY}\\${name}`) : [];
	}
	if (h.platform === "darwin") {
		const file = launchAgentPath(h.home, h.claudeDir);
		if (!await fs.stat(file).catch(() => null)) return [];
		await fs.rm(file, { force: true });
		await run("launchctl", ["bootout", `gui/${h.uid}/${launchAgentLabel(h.claudeDir)}`]);
		return removed(file);
	}
	if (h.platform === "linux") {
		const file = autostartPath(h);
		if (!await fs.stat(file).catch(() => null)) return [];
		await fs.rm(file, { force: true });
		return removed(file);
	}
	return [];
}
//#endregion
//#region src/install/install.ts
const WAKE_EVENTS = ["UserPromptSubmit", "Stop"];
const TIMEOUT_SECONDS = 10;
const wakeScriptPath = (claudeDir) => path.join(claudeDir, "isoplan", "wake.mjs");
/** Where install copies the runner and the defaults it reads, under the plugin's own layout. */
const runnerAppDir = (claudeDir) => path.join(claudeDir, "isoplan", "runner", "app");
const RUNNER_FILES = [
	"config.json",
	"runner.json",
	"secret-patterns.json",
	"prompts/instructions.md",
	"prompts/question.md",
	"prompts/brief.md",
	"prompts/spin-off.md",
	"dist/connect.js",
	"dist/runner.js"
];
/** The link handler's copy, which the operating system runs for an isoplan:// link. */
const connectScriptPath = (claudeDir) => path.join(runnerAppDir(claudeDir), copiedAs("dist/connect.js"));
/** A file's name in the copy: the bundle is an ES module and no package.json beside the copy says so, so it is .mjs, as wake.mjs is. */
const copiedAs = (file) => file.replace(/\.js$/, ".mjs");
/** The uninstall's lock, which also holds off a retry once one has failed. */
const uninstallLockPath = (claudeDir) => path.join(claudeDir, "isoplan", "uninstall.json");
/** Where an uninstall in the background says what stopped it. */
const uninstallLogPath = (claudeDir) => path.join(claudeDir, "isoplan", "uninstall.log");
/**
* The hook's command. Shell form, quoted, with forward slashes, so Git Bash, PowerShell and sh all
* read the path the same way.
*/
const wakeCommand = (script) => `node "${script.replace(/\\/g, "/")}"`;
/** The script a hook command runs with node, as `node "<script>"` or `node <script>`; null for any other command. */
function nodeScriptOf(command) {
	const m = /^\s*node(?:\.exe)?\s+(?:"([^"]+)"|'([^']+)'|(\S+))\s*$/i.exec(command);
	return m ? m[1] ?? m[2] ?? m[3] : null;
}
const isWakeFor = (claudeDir) => {
	const script = normalPath(wakeScriptPath(claudeDir));
	return (hook) => {
		const command = hook?.command;
		const runs = typeof command === "string" ? nodeScriptOf(command) : null;
		return runs !== null && normalPath(runs) === script;
	};
};
/**
* Copies `wakeSource` (dist/wake.js) into place, records `dataLayer`, and adds or updates the hooks.
* With `runnerFrom` (the plugin's folder) it copies the runner too, and records the copy.
* Returns what it changed, [] when it was all there. Throws when settings.json can't be merged.
* With `auto` (the plugin's data layer) it does nothing once the hook has been uninstalled, but
* finish what that uninstall left (a wake.mjs no hook names), or once Claude Code lists the plugin
* `dataLayer` belongs to as uninstalled: a session that loaded it before then still runs it.
*
* A background uninstall that is running is waited for, up to `waitMs`; one still running then
* leaves the plugin's data layer doing nothing (its next start tries again), and the install
* script failing. An uninstall that failed, or whose process has gone, leaves its lock and log,
* which go now, since the plugin is wanted after all.
*/
async function installWake(paths, dataLayer, wakeSource, { auto = false, runnerFrom, findClaude, waitMs = INSTALL_WAIT_MS, linkHandler, loginItem } = {}) {
	const { claudeDir, settings } = paths;
	if (auto && await isOptedOut(claudeDir)) return finishOptOut(paths);
	if (auto && await pluginState(paths, dataLayer) === "uninstalled") return [];
	if (!await waitForUninstall(claudeDir, waitMs)) {
		if (auto) return [];
		throw new Error(`an uninstall is running (${uninstallLockPath(claudeDir)}); try again once it is done`);
	}
	const isWake = isWakeFor(claudeDir);
	const current = await readSettings(settings);
	const script = wakeScriptPath(claudeDir);
	const hooks = current.hooks ??= {};
	if (typeof hooks !== "object" || Array.isArray(hooks)) throw new Error(`${settings}: "hooks" isn't an object; left it alone`);
	const want = {
		type: "command",
		command: wakeCommand(script),
		timeout: TIMEOUT_SECONDS
	};
	const done = [];
	for (const event of WAKE_EVENTS) {
		const groups = hooks[event] ??= [];
		if (!Array.isArray(groups)) throw new Error(`${settings}: hooks.${event} isn't a list; left it alone`);
		let found = false;
		let changed = false;
		const kept = groups.filter((group) => {
			const list = group?.hooks;
			if (!Array.isArray(list) || !list.some(isWake)) return true;
			group.hooks = list.flatMap((hook) => {
				if (!isWake(hook)) return [hook];
				if (found) {
					changed = true;
					return [];
				}
				found = true;
				if (JSON.stringify(hook) !== JSON.stringify(want)) changed = true;
				return [want];
			});
			return group.hooks.length > 0;
		});
		if (!found) kept.push({ hooks: [want] });
		hooks[event] = kept;
		if (!found) done.push(`added the wake hook to ${settings} on ${event}`);
		else if (changed) done.push(`updated the wake hook in ${settings} on ${event}`);
	}
	const changes = [];
	let runner;
	if (runnerFrom) {
		const app = runnerAppDir(claudeDir);
		let copied = false;
		for (const file of RUNNER_FILES) if (await writeIfChanged(path.join(app, copiedAs(file)), await fs.readFile(path.join(runnerFrom, file), "utf8"))) copied = true;
		runner = path.join(app, copiedAs("dist/runner.js"));
		if (copied) changes.push(`copied the runner to ${app}`);
	}
	const record = runner ? {
		dataLayer,
		runner
	} : { dataLayer };
	await fs.mkdir(path.dirname(script), { recursive: true });
	if (await writeIfChanged(script, await fs.readFile(wakeSource, "utf8"))) changes.push(`copied the wake hook to ${script}`);
	if (await writeIfChanged(wakeRecordPath(claudeDir), JSON.stringify(record, null, 2) + "\n")) changes.push(`recorded the data layer at ${dataLayer}${runner ? ` and the runner at ${runner}` : ""}`);
	const binary = claudeBinaryPath(claudeDir);
	const kind = await binaryRecord(binary);
	if (kind === "broken") changes.push(`kept ${binary}, which doesn't parse: it may have been edited by hand`);
	const claude = findClaude && (kind === "none" || kind === "auto") ? await findClaude() : null;
	if (claude && await writeIfChanged(binary, JSON.stringify({
		path: claude,
		auto: true
	}, null, 2) + "\n")) changes.push(`recorded the claude binary at ${claude}`);
	for (const file of [uninstallLogPath(claudeDir), uninstallLockPath(claudeDir)]) if (await fs.rm(file).then(() => true, () => false)) changes.push(`removed ${file}, left by an uninstall that didn't finish`);
	if (runnerFrom && linkHandler) changes.push(...await registerLinkHandler({
		...linkHandler,
		claudeDir,
		script: connectScriptPath(claudeDir)
	}).catch((err) => [`couldn't register isoplan:// links: ${String(err?.message ?? err)}`]));
	if (runnerFrom && loginItem) {
		const item = {
			...loginItem,
			claudeDir,
			script
		};
		const on = await startsAtLogin(path.join(runnerFrom, "runner.json"), path.join(claudeDir, "isoplan", "runner.json"));
		changes.push(...await (on ? registerLoginItem(item) : unregisterLoginItem(item)).catch((err) => [`couldn't ${on ? "set the runner to start" : "take out the runner's start"} at login: ${String(err?.message ?? err)}`]));
	}
	if (done.length) await writeSettings(settings, current);
	return [...changes, ...done];
}
/** How long an install waits for a running background uninstall. */
const INSTALL_WAIT_MS = 15e3;
async function waitForUninstall(claudeDir, waitMs) {
	const file = uninstallLockPath(claudeDir);
	for (const until = Date.now() + waitMs;; await new Promise((r) => setTimeout(r, 250))) {
		const pid = (await readLock(file))?.pid;
		if (!pid || !alive(pid)) return true;
		if (Date.now() >= until) return false;
	}
}
async function finishOptOut({ claudeDir, settings }) {
	const isWake = isWakeFor(claudeDir);
	const hooks = await readSettings(settings).then((current) => current.hooks, () => void 0);
	const named = !!hooks && typeof hooks === "object" && Object.values(hooks).some((groups) => Array.isArray(groups) && groups.some((g) => Array.isArray(g?.hooks) && g.hooks.some(isWake)));
	const changes = [];
	if (named || !await waitForUninstall(claudeDir, 0)) return changes;
	for (const file of [
		wakeScriptPath(claudeDir),
		uninstallLogPath(claudeDir),
		uninstallLockPath(claudeDir)
	]) if (await fs.rm(file).then(() => true, () => false)) changes.push(`removed ${file}, left by an uninstall`);
	return changes;
}
async function binaryRecord(file) {
	let text;
	try {
		text = await fs.readFile(file, "utf8");
	} catch {
		return "none";
	}
	try {
		const record = JSON.parse(text);
		if (record?.auto === true) return "auto";
		return typeof record?.path === "string" && record.path !== "" ? "hand" : "broken";
	} catch {
		return "broken";
	}
}
async function isOptedOut(claudeDir) {
	try {
		return JSON.parse(await fs.readFile(wakeRecordPath(claudeDir), "utf8")).disabled === true;
	} catch {
		return false;
	}
}
/** The settings as an object; {} when there is no file yet. A leading byte order mark is skipped. Throws when it isn't a JSON object. */
async function readSettings(file) {
	let text;
	try {
		text = await fs.readFile(file, "utf8");
	} catch (err) {
		if (err.code === "ENOENT") return {};
		throw err;
	}
	let value;
	try {
		value = JSON.parse(text.replace(/^﻿/, ""));
	} catch {
		throw new Error(`${file} isn't valid JSON; left it alone`);
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${file} isn't a JSON object; left it alone`);
	return value;
}
/** Writes the settings whole, as two-space JSON. */
const writeSettings = (file, settings) => writeWhole(file, JSON.stringify(settings, null, 2) + "\n");
async function writeIfChanged(file, text) {
	if (await fs.readFile(file, "utf8").catch(() => null) === text) return false;
	await writeWhole(file, text);
	return true;
}
async function writeWhole(file, text) {
	const target = await fs.realpath(file).catch(() => file);
	const mode = (await fs.stat(target).catch(() => null))?.mode;
	await fs.mkdir(path.dirname(target), { recursive: true });
	const temp = `${target}.isoplan-${process.pid}`;
	try {
		await fs.writeFile(temp, text);
		if (mode !== void 0) await fs.chmod(temp, mode & 4095);
		await fs.rename(temp, target);
	} catch (err) {
		await fs.rm(temp, { force: true }).catch(() => {});
		throw err;
	}
}
//#endregion
//#region src/pipe/pipe.ts
const pipeInfoPath = (claudeDir) => path.join(claudeDir, "isoplan", "runner", "pipe.json");
const newNonce = () => randomBytes(16).toString("hex");
const proofOf = (token, nonce) => createHmac("sha256", token).update(nonce).digest("hex");
/** The variables of a session's environment its hooks module's end passes on, which the runner reports that session by (report-session.ts). */
const SESSION_ENV = [
	"CLAUDE_CODE_PLUGIN_CACHE_DIR",
	"CLAUDE_CODE_PLUGIN_DIRS",
	"DISABLE_UPDATES",
	"DISABLE_AUTOUPDATER",
	"CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
	"FORCE_AUTOUPDATE_PLUGINS"
];
/** Those of SESSION_ENV that `env` sets. */
const sessionEnv = (env) => Object.fromEntries(SESSION_ENV.flatMap((name) => typeof env[name] === "string" ? [[name, env[name]]] : []));
async function readPipeInfo(claudeDir) {
	try {
		const { address, token } = JSON.parse(await fs.readFile(pipeInfoPath(claudeDir), "utf8"));
		return typeof address === "string" && typeof token === "string" ? {
			address,
			token
		} : null;
	} catch {
		return null;
	}
}
const PROOF_WAIT_MS = 5e3;
/**
* Connects to the pipe at `info.address` and has the runner prove it knows the token (see above).
* Resolves the socket once it has, with every later line given to `onLine`; null when the pipe
* can't be reached or doesn't prove it, and then nothing of the client's went to it.
*/
function openPipe(info, onLine) {
	return new Promise((resolve) => {
		const nonce = newNonce();
		const want = Buffer.from(proofOf(info.token, nonce));
		let proven = false;
		const socket = net.connect(info.address);
		const fail = () => {
			clearTimeout(timer);
			socket.destroy();
			resolve(null);
		};
		const timer = setTimeout(fail, PROOF_WAIT_MS);
		socket.once("connect", () => writeLine(socket, {
			type: "hi",
			v: 1,
			nonce
		}));
		socket.on("error", () => {}).once("close", () => proven || fail());
		readLines(socket, (value) => {
			if (proven) return onLine(value);
			const said = value;
			const proof = said?.type === "proof" ? said.proof : void 0;
			if (typeof proof !== "string" || Buffer.byteLength(proof) !== want.length || !timingSafeEqual(Buffer.from(proof), want)) return fail();
			proven = true;
			clearTimeout(timer);
			resolve(socket);
		});
	});
}
/** Calls `onLine` with each whole line that comes in on `socket`, parsed; a line that isn't JSON is passed over. */
function readLines(socket, onLine, maxBytes = 1 << 20) {
	let buffer = "";
	socket.setEncoding("utf8").on("data", (piece) => {
		buffer += piece;
		let nl;
		while ((nl = buffer.indexOf("\n")) >= 0) {
			const text = buffer.slice(0, nl).trim();
			buffer = buffer.slice(nl + 1);
			if (!text) continue;
			let value;
			try {
				value = JSON.parse(text);
			} catch {
				continue;
			}
			onLine(value);
		}
		if (buffer.length > maxBytes) socket.destroy();
	});
}
const writeLine = (socket, value) => {
	if (!socket.destroyed && socket.writable) socket.write(JSON.stringify(value) + "\n");
};
//#endregion
//#region src/data-layer/git.ts
function isAbsolute(p) {
	return /^[A-Za-z]:[\\/]/.test(p) || p.startsWith("/") || p.startsWith("\\");
}
/**
* Forward slashes, "." and ".." folded away, no trailing slash, drive letter upper-cased.
* The root keeps its slash ("C:/", "/").
*/
function normalize(p) {
	let s = p.replace(/\\/g, "/");
	let prefix = "";
	const drive = /^([A-Za-z]):(\/|$)/.exec(s);
	if (drive) {
		prefix = drive[1].toUpperCase() + ":/";
		s = s.slice(drive[0].length);
	} else if (s.startsWith("//")) {
		prefix = "//";
		s = s.slice(2);
	} else if (s.startsWith("/")) {
		prefix = "/";
		s = s.slice(1);
	}
	const out = [];
	for (const part of s.split("/")) {
		if (part === "" || part === ".") continue;
		if (part === ".." && out.length && out[out.length - 1] !== "..") out.pop();
		else if (part !== ".." || !prefix) out.push(part);
	}
	return prefix + out.join("/") || ".";
}
function join(base, rel) {
	return isAbsolute(rel) ? normalize(rel) : normalize(base + "/" + rel);
}
new TextEncoder();
new TextEncoder();
//#endregion
//#region src/data-layer/claude-paths.ts
/**
* Claude Code's config folder and its .claude.json: both in $CLAUDE_CONFIG_DIR when it is set,
* else ~/.claude and ~/.claude.json, where Claude Code itself looks.
*/
function claudePaths(env, home) {
	const custom = env.CLAUDE_CONFIG_DIR;
	return custom ? {
		dir: normalize(custom),
		json: join(custom, ".claude.json")
	} : {
		dir: join(home, ".claude"),
		json: join(home, ".claude.json")
	};
}
//#endregion
//#region src/data-layer/report-session.ts
const LOG_CAP_BYTES = 65536;
/** Starts `node <args>` detached and hidden, without waiting for it. */
const spawnHidden = (args, dir, env) => spawn(process.execPath, args, {
	cwd: dir,
	env,
	detached: true,
	stdio: "ignore",
	windowsHide: true
}).on("error", () => {}).unref();
/** Where this machine finds the claude binary, and keeps the isoplan:// link handler and the login item (src/install). */
const systemPlaces = () => ({
	findClaude: () => findClaude(process.env, process.platform, os.homedir()),
	linkHandler: {
		platform: process.platform,
		home: os.homedir(),
		dataHome: process.env.XDG_DATA_HOME,
		node: process.execPath
	},
	loginItem: {
		platform: process.platform,
		home: os.homedir(),
		configHome: process.env.XDG_CONFIG_HOME,
		uid: process.getuid?.(),
		node: process.execPath
	}
});
/** This computer, for the desktop app. */
const appComputer = () => ({
	platform: process.platform,
	arch: process.arch,
	home: os.homedir(),
	env: process.env
});
/**
* The machine's part of a current copy of the plugin's start (the hooks module's end of the pipe, src/pipe/main.ts): the wake hook and the runner's copy
* (src/install), then the runner (src/runner/start.ts), which replaces one running older code. The
* runner answers for the machine's rooms and reports every session. Not
* while the plugin is disabled for the machine, though a session's project enables it. Then, in the
* background (`app`), the desktop app this version names, which takes over from the node runner once
* it is in place.
*/
function startMachine(o) {
	const self = path.join(o.here, "data-layer.js");
	const installed = installWake({
		...o.place,
		settings: path.join(o.place.claudeDir, "settings.json")
	}, self, path.join(o.here, "wake.js"), {
		auto: true,
		runnerFrom: path.join(o.here, ".."),
		findClaude: o.findClaude,
		linkHandler: o.linkHandler,
		loginItem: o.loginItem
	}).then((changes) => changes.forEach((text) => o.log(text)), (err) => o.log(`couldn't install the wake hook: ${String(err?.message ?? err)}`));
	const started = installed.then(async () => await pluginState(o.place, self) === "enabled" ? startRunner({
		claudeDir: o.place.claudeDir,
		spawn: o.spawn
	}) : null).catch(() => null);
	return {
		installed,
		started,
		app: started.then(async (runner) => {
			if (!o.app || runner === null) return;
			const { changes } = await installApp({
				...o.app,
				claudeDir: o.place.claudeDir,
				from: path.join(o.here, "..")
			});
			changes.forEach((text) => o.log(text));
			if (changes.length) await startRunner({
				claudeDir: o.place.claudeDir,
				spawn: o.spawn
			});
		}).catch((err) => o.log(`couldn't install the desktop app: ${String(err?.message ?? err)}`))
	};
}
/**
* For `--detached` (main.ts): a wake hook or runner of an earlier version started this data layer
* for a session without a hooks module, which the runner reports now (src/runner/reporting.ts).
* So it does the machine's part of its start (startMachine), putting this version's wake hook and
* runner in place and starting that runner in place of the older one, says so in the session's
* log, and is done. An outdated copy does nothing, so it never hands them back to older code.
*/
async function startDetached(o) {
	const { dir: claudeDir } = claudePaths(process.env, os.homedir());
	const here = path.join(o.appDir, "dist");
	const self = path.join(here, "data-layer.js");
	const place = {
		claudeDir,
		plugins: pluginsDir(claudeDir, process.env),
		managed: managedDir(process.platform),
		pluginDirs: pluginDirsOf(process.env)
	};
	const said = o.sessionId ? sessionLog(claudeDir, o.sessionId) : null;
	const say = (text) => said?.say(text);
	if (await newestDataLayer(place.plugins, self, o.project ?? void 0).catch(() => self) !== self) say("an earlier version's wake hook or runner started an outdated copy of the plugin's data layer for this session, which does nothing: the newest version's runner reports sessions without the plugin");
	else {
		const started = await startMachine({
			place,
			here,
			spawn: o.spawn,
			log: say,
			findClaude: o.findClaude,
			linkHandler: o.linkHandler,
			loginItem: o.loginItem
		}).started;
		say(`an earlier version's wake hook or runner asked for this session to be reported: the runner reports it now, so this data layer ends (${started === null ? "the plugin is disabled for this machine, so the runner wasn't started" : {
			started: "started the runner",
			running: "the runner was already running",
			"held-off": "the runner is holding off for now (see runner.log)",
			"not-installed": "the runner's copy isn't in place, so it wasn't started"
		}[started]})`);
	}
	await said?.flushed();
}
/**
* Where a session the runner reports says what it does: its log lines, the office's errors and
* pairing links, in <claude dir>/isoplan/logs/<session>.log; the rest is for a hooks module, so dropped.
* `flushed` settles once what was said so far is written.
*/
function sessionLog(claudeDir, sessionId) {
	const file = path.join(claudeDir, "isoplan", "logs", `${sessionId}.log`);
	let logging = Promise.resolve();
	const say = (said) => {
		const text = `${(/* @__PURE__ */ new Date()).toISOString()} ${said}
`;
		logging = logging.then(() => writeLog(file, text)).catch(() => {});
	};
	return {
		emit: (line) => {
			if (line.type === "log" || line.type === "error" || line.type === "pair") say(line.type === "log" ? line.text : line.type === "pair" ? pairNote(line) : `the office server says: ${line.message} (${line.code})`);
		},
		say,
		flushed: () => logging
	};
}
/** A pair line as the log says it. */
const pairNote = (line) => `to report to ${line.server}, pair this machine: click ${line.url} on this computer and approve it in the office (it works until ${line.expires})`;
async function writeLog(file, text) {
	const size = (await fs.stat(file).catch(() => null))?.size ?? 0;
	await fs.mkdir(path.dirname(file), { recursive: true });
	if (size > LOG_CAP_BYTES) await fs.writeFile(file, text);
	else await fs.appendFile(file, text);
}
//#endregion
//#region src/pipe/client.ts
const sleepFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const HELD = {
	"held-off": "Isoplan's runner is holding off for now (runner.log says why), so this session isn't reported until it starts again",
	"not-installed": "Isoplan's runner isn't installed here, so this session isn't reported; run the plugin's install script"
};
/** Relays the runner's lines for the session until it is superseded or should stop. */
async function relay(o) {
	const sleep = o.sleep ?? sleepFor;
	const readInfo = o.readInfo ?? readPipeInfo;
	let down = false;
	let held = null;
	while (o.goOn()) {
		const info = await readInfo(o.claudeDir);
		let superseded = false;
		const socket = info && await openPipe(info, (value) => {
			const line = value;
			if (!line || typeof line !== "object" || typeof line.type !== "string") return;
			o.out(line);
			if (line.type === "superseded") superseded = true;
		});
		if (socket && info) {
			if (down) o.out({
				type: "runner",
				state: "up"
			});
			down = false;
			held = null;
			await new Promise((resolve) => {
				socket.on("close", () => resolve());
				writeLine(socket, {
					type: "hello",
					v: 1,
					token: info.token,
					...o.hello
				});
			});
			if (superseded) return "superseded";
			if (!o.goOn()) break;
		}
		if (!down) o.out({
			type: "runner",
			state: "down"
		});
		down = true;
		const started = await o.startRunner().catch(() => null);
		const now = started === "held-off" || started === "not-installed" ? started : null;
		if (now !== held) {
			o.out(now ? {
				type: "runner",
				state: "down",
				held: now
			} : {
				type: "runner",
				state: "down"
			});
			if (now) o.say?.(HELD[now]);
			held = now;
		}
		await sleep(await o.retryMs());
	}
	return "stopped";
}
//#endregion
//#region src/pipe/main.ts
const PARENT_CHECK_MS = 5e3;
const value$1 = (argv, flag) => {
	const i = argv.indexOf(flag);
	return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : null;
};
/** Runs the pipe's end for the session the arguments name; `appDir` is the plugin's folder. */
async function pipeMain(argv, appDir) {
	const session = value$1(argv, "--session");
	const cwd = value$1(argv, "--cwd");
	if (!session || !cwd) {
		process.stderr.write("usage: node pipe.js --session <id> --cwd <dir> [--since <ms>] [--messages]\n");
		return 2;
	}
	const { dir: claudeDir } = claudePaths(process.env, os.homedir());
	const parent = process.ppid;
	let isOut = true;
	process.stdout.on("error", () => isOut = false);
	const out = (line) => {
		if (isOut) process.stdout.write(JSON.stringify(line) + "\n");
	};
	const goOn = () => isOut && process.ppid === parent && alive(parent);
	setInterval(() => goOn() || process.exit(0), PARENT_CHECK_MS).unref();
	const here = path.join(appDir, "dist");
	const place = {
		claudeDir,
		plugins: pluginsDir(claudeDir, process.env),
		managed: managedDir(process.platform),
		pluginDirs: pluginDirsOf(process.env)
	};
	const self = path.join(here, "data-layer.js");
	if (!(await newestDataLayer(place.plugins, self, cwd).catch(() => self) !== self)) await startMachine({
		place,
		here,
		spawn: spawnHidden,
		log: (text) => out({
			type: "log",
			text
		}),
		...systemPlaces(),
		app: appComputer()
	}).started;
	const io = nodeIo();
	const version = await fs.readFile(path.join(appDir, ".claude-plugin", "plugin.json"), "utf8").then((text) => String(JSON.parse(text).version ?? "0.0.0")).catch(() => "0.0.0");
	const said = sessionLog(claudeDir, session);
	await relay({
		claudeDir,
		hello: {
			session,
			cwd,
			since: Number(value$1(argv, "--since")) || Date.now(),
			messages: argv.includes("--messages"),
			root: appDir,
			version,
			env: sessionEnv(process.env)
		},
		out,
		goOn,
		startRunner: () => startRunner({
			claudeDir,
			spawn: spawnHidden
		}),
		say: said.say,
		retryMs: async () => (await loadConfig(io, path.join(appDir, "config.json"), path.join(claudeDir, "isoplan", "config.json"))).runnerRetrySeconds * 1e3
	});
	await said.flushed();
	return 0;
}
/** Runs it as the process's whole job, from a script one folder below the plugin's folder. */
async function runPipe(scriptUrl) {
	const crash = (err) => {
		process.stderr.write(`${String(err?.stack ?? err)}\n`);
		process.exit(1);
	};
	process.on("uncaughtException", crash).on("unhandledRejection", crash);
	process.exitCode = await pipeMain(process.argv.slice(2), path.join(path.dirname(fileURLToPath(scriptUrl)), "..")).catch(crash);
	process.exit();
}
//#endregion
//#region src/data-layer/main.ts
const argv = process.argv.slice(2);
const value = (flag) => {
	const i = argv.indexOf(flag);
	return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : null;
};
if (argv.includes("--detached")) {
	const appDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
	await startDetached({
		sessionId: value("--session"),
		project: value("--project") ?? value("--cwd"),
		appDir,
		spawn: spawnHidden,
		...systemPlaces()
	}).catch(() => {});
	process.exit(0);
}
await runPipe(import.meta.url);
//#endregion
export {};
