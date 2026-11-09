import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomBytes } from "node:crypto";
import { execFile, spawn, spawnSync } from "node:child_process";
import { realpath, statSync } from "node:fs";
import { promisify } from "node:util";
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
function isObject(data) {
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
	if (isObject(o) === false) return false;
	const ctor = o.constructor;
	if (ctor === void 0) return true;
	if (typeof ctor !== "function") return true;
	const prot = ctor.prototype;
	if (isObject(prot) === false) return false;
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
/** Format a ZodError as a human-readable string in the following form.
*
* From
*
* ```ts
* ZodError {
*   issues: [
*     {
*       expected: 'string',
*       code: 'invalid_type',
*       path: [ 'username' ],
*       message: 'Invalid input: expected string'
*     },
*     {
*       expected: 'number',
*       code: 'invalid_type',
*       path: [ 'favoriteNumbers', 1 ],
*       message: 'Invalid input: expected number'
*     }
*   ];
* }
* ```
*
* to
*
* ```
* username
*   ✖ Expected number, received string at "username
* favoriteNumbers[0]
*   ✖ Invalid input: expected number
* ```
*/
function toDotPath(_path) {
	const segs = [];
	const path = _path.map((seg) => typeof seg === "object" ? seg.key : seg);
	for (const seg of path) if (typeof seg === "number") segs.push(`[${seg}]`);
	else if (typeof seg === "symbol") segs.push(`[${JSON.stringify(String(seg))}]`);
	else if (/[^\w$]/.test(seg)) segs.push(`[${JSON.stringify(seg)}]`);
	else {
		if (segs.length) segs.push(".");
		segs.push(seg);
	}
	return segs.join("");
}
function prettifyError(error) {
	const lines = [];
	const issues = [...error.issues].sort((a, b) => (a.path ?? []).length - (b.path ?? []).length);
	for (const issue of issues) {
		lines.push(`✖ ${issue.message}`);
		if (issue.path?.length) lines.push(`  → at ${toDotPath(issue.path)}`);
	}
	return lines.join("\n");
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
	const isObject$1 = isObject;
	const catchall = def.catchall;
	let value;
	const memo = globalConfig.memoizer;
	memo?.attach(inst);
	inst._zod.parse = (payload, ctx) => {
		value ?? (value = _normalized.value);
		const input = payload.value;
		if (!isObject$1(input)) {
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
	const isObject$2 = isObject;
	const jit = !globalConfig.jitless;
	const fastEnabled = jit && allowsEval.value;
	const catchall = def.catchall;
	let value;
	inst._zod.parse = (payload, ctx) => {
		value ?? (value = _normalized.value);
		const input = payload.value;
		if (!isObject$2(input)) {
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
		if (!isObject(input)) {
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
const parse$1 = /* @__PURE__ */ _parse(ZodRealError);
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
		return parse$1(this, data, params, { callee: _parse });
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
	hooks: literal(true).optional(),
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
* server keeps it only for the retention period. `id` is the tool call's own id. An option's
* `preview` (protocol 0.11.0 on) is the option's preview as the agent gave it, which Claude Code
* shows when the option is focused. `answerable`: the session's own hooks module is waiting for it,
* so an answer from the floor answers the dialog itself. `asMessage` (protocol 0.11.0 on): the
* question can be answered from the floor even though the hooks module didn't see it asked (it was
* asked before the plugin loaded): the plugin stops the agent's turn, which closes the dialog, and
* submits the answers as the owner's own message. It never comes with `answerable` or `withheld`.
* With neither, the floor shows the question read-only, and it is answered in the terminal.
* `withheld`: the secret scan matched its text, or the patterns couldn't be read, so `questions` is
* only a placeholder; it is answered in the terminal.
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
			description: string(),
			preview: string().optional()
		})),
		multiSelect: boolean()
	})).min(1),
	answerable: literal(true).optional(),
	asMessage: literal(true).optional(),
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
/** The longest task a handoff of its own task (a spin-off) carries (protocol 0.10.0). */
const MAX_TASK_LENGTH = 4e3;
/** A spin-off's task: what the new session is to do, as the person handing over typed it. */
const Task = string().trim().min(1).max(MAX_TASK_LENGTH);
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
				"crashed",
				"removed"
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
		answers: record(string(), string()),
		annotations: record(string(), object({
			notes: string().optional(),
			preview: string().optional()
		})).optional(),
		chat: literal(true).optional()
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
const OfficeServerMessageSchema = discriminatedUnion("type", [
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
			session: DrivenSessionId,
			remove: literal(true).optional()
		}),
		object({
			...drive,
			kind: literal("interrupt"),
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
/** Validates a message a data layer received from an office server. */
function parseOfficeServerMessage(value) {
	return parse(OfficeServerMessageSchema, value);
}
function parse(schema, value) {
	if (typeof value === "object" && value !== null && "v" in value && typeof value.v === "number" && value.v !== 1) return {
		ok: false,
		kind: "unsupported-version",
		error: `protocol version ${JSON.stringify(value.v)} is not supported; this side speaks version 1`
	};
	const result = schema.safeParse(value);
	if (result.success) return {
		ok: true,
		message: result.data
	};
	return {
		ok: false,
		kind: "invalid",
		error: prettifyError(result.error)
	};
}
//#endregion
//#region ../protocol/dist/project-id.js
/**
* A project's id and name. With a git remote the id is `host/owner/repo` (any deeper path kept, as
* for GitLab subgroups), the same whichever form or letter case the remote is written in, so a
* repository cloned on several machines is one project. A repo with no remote, a remote that is a
* local path, or one that can't be read is `local:<machine>/<root>`, its working tree's root path.
* Never throws, so a remote's credentials never reach an error message.
*/
function projectId(remoteUrl, local) {
	const remote = remoteUrl === null || isLocalPath(remoteUrl.trim()) ? null : splitRemote(remoteUrl.trim());
	const segments = remote?.path.replace(/\/+$/, "").replace(/\.git$/, "").split("/").filter(Boolean);
	if (!remote || !segments || segments.length === 0) {
		const root = local.root.replace(/\\/g, "/").replace(/\/+$/, "");
		return {
			id: `local:${local.machine}/${root}`,
			name: root.split("/").pop() || root
		};
	}
	return {
		id: [remote.host, ...segments].join("/").toLowerCase(),
		name: segments[segments.length - 1]
	};
}
function isLocalPath(remote) {
	return remote === "" || /^(?:[/.~\\]|[A-Za-z]:[\\/]|file:)/.test(remote);
}
function splitRemote(remote) {
	if (remote.includes("://")) {
		if (!URL.canParse(remote)) return null;
		const url = new URL(remote);
		return url.hostname ? {
			host: url.hostname,
			path: url.pathname
		} : null;
	}
	const scp = /^(?:[^@/]+@)?([^:/]+):(.+)$/.exec(remote);
	return scp ? {
		host: scp[1],
		path: scp[2]
	} : null;
}
//#endregion
//#region src/data-layer/config.ts
async function loadConfig(io, defaultsPath, userPath) {
	const config = await loadSettings(io, defaultsPath, userPath);
	const asked = (await readJson(io, userPath, true)).server;
	if (typeof asked === "string" && URL.canParse(asked) && new URL(asked).protocol === "ws:" && !LOOPBACK$1.has(new URL(asked).hostname)) {
		if (config.allowPlainWs) config.server = asked;
		else config.plainRefused = asked;
	}
	return config;
}
/**
* The offices to report to: each entry of `servers` with a ws:// or wss:// address (ws:// goes only
* to this machine unless allowPlainWs; to another it is kept, to say why it isn't used), once per
* address; with none, `server` alone. An entry without a label is labelled by its host, and a label
* already taken gets -2, -3 and so on, so each names one office.
*/
function officesOf(config) {
	const offices = [];
	const add = (server, label, refused) => {
		let unique = label;
		for (let n = 2; offices.some((o) => o.label.toLowerCase() === unique.toLowerCase()); n++) unique = `${label}-${n}`;
		offices.push({
			label: unique,
			server,
			...refused && { plainRefused: true },
			...server === config.server && { legacy: true }
		});
	};
	for (const entry of config.servers) {
		const { label, server } = entry ?? {};
		if (typeof server !== "string" || !URL.canParse(server) || !["ws:", "wss:"].includes(new URL(server).protocol) || offices.some((o) => o.server === server)) continue;
		add(server, typeof label === "string" && label.trim() || new URL(server).host, !config.allowPlainWs && !isWebSocketUrl(server));
	}
	if (!offices.length) add(config.plainRefused ?? config.server, new URL(config.plainRefused ?? config.server).host, !!config.plainRefused);
	return offices;
}
/** The office `--office` names: by its label (in any case), its address, or its address's host. */
function officeNamed(offices, name) {
	const n = name.trim();
	return offices.find((o) => o.label.toLowerCase() === n.toLowerCase()) ?? offices.find((o) => o.server === n || new URL(o.server).host === n.toLowerCase());
}
/** The same per-key override for any settings file of the mod's, such as the runner's runner.json. */
async function loadSettings(io, defaultsPath, userPath) {
	const defaults = await readJson(io, defaultsPath);
	const user = await readJson(io, userPath, true);
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
const LOOPBACK$1 = /* @__PURE__ */ new Set([
	"127.0.0.1",
	"[::1]",
	"localhost"
]);
function isWebSocketUrl(value) {
	if (!URL.canParse(value)) return false;
	const url = new URL(value);
	return url.protocol === "wss:" || url.protocol === "ws:" && LOOPBACK$1.has(url.hostname);
}
async function readJson(io, p, optional = false) {
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
//#region src/handoff/offices.ts
async function findRoom(offices, hint, code, io) {
	const decide = async (office, project) => await io.takes(office, project) ? {
		office,
		project
	} : { refused: `The handoff's repo, ${project}, isn't on this machine's copy of ${offices.length > 1 ? `the ${io.label(office)} office's` : "the office's"} list, so nothing is sent. A Claude Code session with the Isoplan plugin reads it again within a few minutes; take it then.` };
	if (hint) {
		const answer = await io.ask(hint, code);
		return "unknown" in answer ? { refused: offices.length > 1 ? `The ${io.label(hint)} office couldn't give that take code: ${answer.unknown}` : answer.unknown } : decide(hint, answer.project);
	}
	const said = [];
	for (const office of offices) {
		const answer = await io.ask(office, code);
		if ("project" in answer) return decide(office, answer.project);
		said.push(offices.length > 1 ? `${io.label(office)}: ${answer.unknown}` : answer.unknown);
	}
	return { refused: offices.length > 1 ? `No office here knows that take code.\n${said.join("\n")}` : said[0] };
}
/**
* The office a hand-over goes to, of those whose list takes the session's repo (`taking`, in
* config.json's order): the one `--office` names (`picked`), else the only one; with none, or several
* and none named, why not. `refused` is what the first office not taking it said.
*/
function handOverOffice(taking, picked, refused, label) {
	const several = taking.length > 1;
	if (picked) {
		const chosen = taking.find((t) => t.office === picked);
		return chosen ? {
			...chosen,
			several
		} : { refused: `The ${label(picked)} office doesn't take this repo${taking.length ? `; ${taking.map((t) => label(t.office)).join(", ")} does` : ""}. ${refused}`.trim() };
	}
	if (several) return { refused: `More than one office takes this repo: ${taking.map((t) => label(t.office)).join(", ")}. Ask which one to hand over in, then run this again with --office "<label>".` };
	return taking[0] ? {
		...taking[0],
		several
	} : { refused };
}
//#endregion
//#region src/handoff/taken-office.ts
const SAFE = /^[\w-]{1,200}$/;
const recordPath = (claudeDir, session) => path.join(claudeDir, "isoplan", "handoffs", "sessions", `${session}.json`);
async function recordTakenOffice(claudeDir, session, server) {
	if (!SAFE.test(session)) return;
	const file = recordPath(claudeDir, session);
	await fs.mkdir(path.dirname(file), { recursive: true });
	await fs.writeFile(file, JSON.stringify({ server }) + "\n");
}
//#endregion
//#region src/data-layer/approved-file.ts
/** The folder of what is kept for one office server alone: its list, and its pairing's lock. Named by a hash of its address. */
const officeDir = (claudeDir, server) => path.join(claudeDir, "isoplan", "offices", createHash("sha256").update(server).digest("hex").slice(0, 12));
const approvedPath = (claudeDir, server) => path.join(officeDir(claudeDir, server), "approved.json");
const isFile = (v) => !!v && typeof v.server === "string" && typeof v.version === "string" && typeof v.fetched === "number" && typeof v.checked === "number" && Array.isArray(v.repos) && v.repos.every((r) => typeof r === "string");
/** approved.json, for `server` when given; null when there is none, or it is another server's. */
async function readApproved(file, server) {
	try {
		const value = JSON.parse(await fs.readFile(file, "utf8"));
		return isFile(value) && (server === void 0 || value.server === server) ? value : null;
	} catch {
		return null;
	}
}
/** The approved repos' ids, lower case, while the copy is younger than `maxAgeMs`; null after, or with none. */
function freshRepos(copy, maxAgeMs, now) {
	return copy && now - copy.checked <= maxAgeMs ? new Set(copy.repos.map((r) => r.toLowerCase())) : null;
}
//#endregion
//#region src/data-layer/pairing.ts
const pairingPath = (claudeDir) => path.join(claudeDir, "isoplan", "pairing.json");
/** The account's entry for `server`, or undefined: the one under `offices`, else the one under `accounts` when it is that server's. */
function pairingEntry(all, server, account) {
	const first = all.accounts[account];
	return all.offices?.[server]?.[account] ?? (first?.server === server ? first : void 0);
}
const postJson = async (url, body) => {
	const response = await fetch(url, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
		redirect: "error",
		signal: AbortSignal.timeout(15e3)
	});
	const value = await response.json().catch(() => ({}));
	return {
		status: response.status,
		body: value && typeof value === "object" ? value : {}
	};
};
/** The server's http address for a data-layer path: ws(s)://host/data-layer → http(s)://host/data-layer/<path>. */
function httpUrl(server, sub) {
	const url = new URL(server);
	url.protocol = url.protocol === "wss:" ? "https:" : "http:";
	url.pathname = url.pathname.replace(/\/$/, "") + sub;
	url.search = "";
	return url.toString();
}
const LOOPBACK = /* @__PURE__ */ new Set([
	"127.0.0.1",
	"[::1]",
	"localhost"
]);
/** Whether `server` is plain ws:// to another machine, where a credential would cross the network unencrypted. */
const isPlainRemote = (server) => {
	const url = new URL(server);
	return url.protocol === "ws:" && !LOOPBACK.has(url.hostname);
};
async function readPairing(file) {
	try {
		const value = JSON.parse(await fs.readFile(file, "utf8"));
		return value && typeof value.accounts === "object" && value.accounts ? value : { accounts: {} };
	} catch {
		return { accounts: {} };
	}
}
//#endregion
//#region src/data-layer/approved.ts
/**
* The approved repos as approved.json has them from `server`, for a command that only reads (the
* handoff and ask-the-room commands); null with no copy, or one past `maxAgeMs`.
*/
async function cachedRepos(file, server, maxAgeMs, now = Date.now()) {
	return freshRepos(await readApproved(file, server), maxAgeMs, now);
}
//#endregion
//#region src/data-layer/git.ts
/** True for a Windows-shaped path: a drive letter, a UNC prefix, or any backslash. */
function isWindowsPath(p) {
	return /^[A-Za-z]:([\\/]|$)/.test(p) || p.startsWith("\\\\") || p.includes("\\");
}
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
/** A comparison key: normalised, and case-folded for Windows paths (case-insensitive there). */
function pathKey(p) {
	const n = normalize(p);
	return isWindowsPath(p) || /^[A-Z]:\//.test(n) ? n.toLowerCase() : n;
}
function join(base, rel) {
	return isAbsolute(rel) ? normalize(rel) : normalize(base + "/" + rel);
}
function dirname(p) {
	const n = normalize(p);
	const i = n.lastIndexOf("/");
	if (i < 0) return ".";
	if (i === 0) return "/";
	if (/^[A-Z]:$/.test(n.slice(0, i))) return n.slice(0, i + 1);
	return n.slice(0, i);
}
/**
* `p` relative to `root` with forward slashes, or null when `p` is not inside `root`. Windows
* paths compare case-insensitively; the relative part keeps `p`'s own spelling, so whoever
* matches files by name compares them case-insensitively too.
*/
function relativeTo(root, p) {
	const win = isWindowsPath(root) || isWindowsPath(p);
	const r = normalize(root);
	const n = normalize(p);
	const rk = win ? r.toLowerCase() : r;
	const nk = win ? n.toLowerCase() : n;
	const base = rk.endsWith("/") ? rk : rk + "/";
	if (!nk.startsWith(base)) return null;
	return n.slice(base.length);
}
/**
* Answers are cached per folder and looked up again once older than `maxAgeMs` at `now`, so
* worktrees added or removed and branches switched show up. Calls that pass the same `now` share
* one answer per folder. Without options an answer is kept for the life of the returned object. A
* folder git can't place resolves to null.
*/
function createGit(io) {
	const cache = /* @__PURE__ */ new Map();
	return { resolve(dir, { now = 0, maxAgeMs = Infinity } = {}) {
		const key = pathKey(dir);
		const hit = cache.get(key);
		if (hit && now - hit.at <= maxAgeMs) return hit.result;
		const result = resolveUncached(io, dir).catch(() => null);
		cache.set(key, {
			at: now,
			result
		});
		return result;
	} };
}
async function resolveUncached(io, dir) {
	if (io.run) {
		const viaCommand = await fromCommand(io.run, dir).catch(() => null);
		if (viaCommand) return viaCommand;
	}
	return fromFiles(io, dir);
}
async function fromCommand(run, dir) {
	const where = await run([
		"git",
		"rev-parse",
		"--path-format=absolute",
		"--show-toplevel",
		"--git-common-dir"
	], { cwd: dir });
	if (!where || where.code !== 0) return null;
	const [toplevel, commonDir] = where.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
	if (!toplevel || !commonDir) return null;
	const head = await Promise.resolve().then(() => run([
		"git",
		"rev-parse",
		"--abbrev-ref",
		"HEAD"
	], { cwd: dir })).catch(() => null);
	const name = head && head.code === 0 ? head.stdout.trim() : "";
	return {
		toplevel: normalize(toplevel),
		commonDir: normalize(commonDir),
		branch: name && name !== "HEAD" ? name : null
	};
}
async function fromFiles(io, dir) {
	const self = await io.stat(dir);
	if (!self || !self.isDir) return null;
	let at = normalize(dir);
	for (;;) {
		const dotGit = join(at, ".git");
		const s = await io.stat(dotGit);
		if (s) {
			let gitDir = dotGit;
			let commonDir = dotGit;
			if (!s.isDir) {
				const pointer = /^gitdir:\s*(.+?)\s*$/m.exec(await io.read(dotGit));
				if (!pointer) return null;
				gitDir = join(at, pointer[1]);
				const common = await readOptional(io, join(gitDir, "commondir"));
				commonDir = common ? join(gitDir, common.trim()) : gitDir;
			}
			const head = await readOptional(io, join(gitDir, "HEAD")) || "";
			const ref = /^ref:\s*refs\/heads\/(.+?)\s*$/m.exec(head);
			return {
				toplevel: at,
				commonDir,
				branch: ref ? ref[1] : null
			};
		}
		const up = dirname(at);
		if (up === at) return null;
		at = up;
	}
}
async function readOptional(io, p) {
	try {
		return await io.stat(p) ? await io.read(p) : null;
	} catch {
		return null;
	}
}
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
//#region src/data-layer/identity.ts
/** `claudeJson` is the path of .claude.json (`claudePaths`); git runs in `cwd`. */
async function accountOf(io, claudeJson, cwd) {
	const config = asObject(parseJson(await io.readText(claudeJson)));
	const oauth = asObject(config.oauthAccount);
	const gitName = async () => {
		const r = io.run ? await Promise.resolve(io.run([
			"git",
			"config",
			"user.name"
		], { cwd })).catch(() => null) : null;
		return r && r.code === 0 && r.stdout.trim() ? r.stdout.trim() : null;
	};
	if (nonEmpty(oauth.accountUuid)) return {
		id: `claude:${oauth.accountUuid}`,
		name: nonEmpty(oauth.displayName) ? oauth.displayName : await gitName() ?? ""
	};
	const name = await gitName();
	if (nonEmpty(config.userID)) return {
		id: `claude-install:${config.userID}`,
		name: name ?? ""
	};
	return {
		id: `git:${name ?? "unknown"}`,
		name: name ?? ""
	};
}
/**
* The project the session's folder belongs to: its git remote's, or for a repo with no usable
* remote, the main checkout's folder on this machine (so every worktree of one repo is one
* project). A folder git can't place is its own local project. On a file system that ignores case
* (Windows, macOS) a local project's id is lower-cased, so one folder reached in two spellings is
* one project, in the hello and in every edit alike. With `names`, a remote naming a GitHub repo by
* an old name gives the repo's current id (remote-names.ts), so an old clone is the same project.
*/
async function projectOf(run, where, cwd, machine, { caseless = process.platform === "win32" || process.platform === "darwin", names = null } = {}) {
	let remote = null;
	if (run && where) {
		const r = await Promise.resolve(run([
			"git",
			"remote",
			"get-url",
			"origin"
		], { cwd: where.toplevel })).catch(() => null);
		if (r && r.code === 0 && r.stdout.trim()) remote = r.stdout.trim();
	}
	const root = !where ? normalize(cwd) : /\/\.git$/.test(where.commonDir) ? dirname(where.commonDir) : where.toplevel;
	const project = projectId(remote, {
		machine,
		root
	});
	if (remote !== null && names && !project.id.startsWith("local:")) return names.current(project);
	return caseless && project.id.startsWith("local:") ? {
		...project,
		id: project.id.toLowerCase()
	} : project;
}
function parseJson(text) {
	try {
		return text === null ? null : JSON.parse(text);
	} catch {
		return null;
	}
}
function asObject(value) {
	return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
const nonEmpty = (v) => typeof v === "string" && v.trim() !== "";
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
//#region src/data-layer/home.ts
/** The projects `folder` may report as, and whether it is a workspace. */
async function candidatesOf(folder, io) {
	const where = await io.resolve(folder);
	if (where) return {
		projects: [await io.projectOf(where, folder)],
		workspace: false
	};
	const tooWide = pathKey(folder) === pathKey(io.home) || relativeTo(folder, io.home) !== null;
	const st = await io.stat(folder);
	const repos = [];
	if (!tooWide && st?.isDir) {
		for (const e of await io.listDir(folder)) if (e.isDir && await io.stat(join(folder, `${e.name}/.git`))) repos.push(join(folder, e.name));
	}
	if (!repos.length || repos.length > io.workspaceRepos) return {
		projects: [await io.projectOf(null, folder)],
		workspace: false
	};
	const projects = [];
	for (const dir of repos.sort()) {
		const at = await io.resolve(dir);
		if (at) projects.push(await io.projectOf(at, dir));
	}
	return {
		projects,
		workspace: true
	};
}
/** Whether the repo whose top is `dir` is on `repos`, for a handoff's prepare (handoff/git.ts). */
const takesFrom = (io, repos) => async (dir) => {
	const where = repos && await io.resolve(dir);
	return !!where && repos.has((await io.projectOf(where, dir)).id.toLowerCase());
};
/** A HomeIo on this machine, for the runner and the commands, naming GitHub repos as `names` does. */
function machineHomeIo(workspaceRepos, names = null, machine = os.hostname()) {
	const io = nodeIo();
	const git = createGit(io);
	return {
		resolve: (dir) => git.resolve(dir),
		projectOf: (where, dir) => projectOf(io.run, where, dir, machine, { names }),
		stat: (p) => Promise.resolve(io.stat(p)),
		listDir: (d) => io.listDir(d),
		home: os.homedir(),
		workspaceRepos
	};
}
/**
* What a command (hand-over, ask the room) may say hello as: the session's home, by this machine's
* copy of the office's list, which the session's data layer keeps fresh; or, when there is none, or
* no fresh copy, why nothing is sent.
*/
async function commandHome(folder, io, list) {
	const repos = await cachedRepos(list.file, list.server, list.maxAgeMs, list.now);
	if (!repos) return { refused: `Can't tell which repos ${list.server} takes (this machine's copy of its list is missing or older than ${Math.round(list.maxAgeMs / 6e4)} minutes), so nothing is sent. A Claude Code session with the Isoplan plugin reads it again within a few minutes.` };
	const { projects, workspace } = await candidatesOf(folder, io);
	const home = projects.find((p) => repos.has(p.id.toLowerCase()));
	if (home) return { home };
	return { refused: `${workspace ? "No repo in this folder is" : "This repo isn't"} one the office at ${list.server} takes, so nothing of it is sent there. An admin adds it under Repos on the floor.` };
}
//#endregion
//#region src/data-layer/remote-names.ts
/** Where the answers are kept. */
const remoteNamesPath = (claudeDir) => path.join(claudeDir, "isoplan", "remote-names.json");
const ANSWER_MS$1 = 864e5;
const RETRY_MS = 3e5;
/**
* The repos' current names. With `ask`, for a long-lived process, GitHub is asked as above; without
* it the cache is only read.
*/
function remoteNames({ file, ask = null, now = Date.now }) {
	let entries = null;
	const asking = /* @__PURE__ */ new Map();
	const load = () => entries ??= readEntries(file);
	const stale = (e) => now() - e.at >= (e.failures ? Math.min(ANSWER_MS$1, RETRY_MS * 2 ** (e.failures - 1)) : ANSWER_MS$1);
	const refresh = (id, owner, repo) => {
		const running = asking.get(id);
		if (running) return running;
		const done = (async () => {
			const onDisk = (await readEntries(file))[id];
			const known = await load();
			if (onDisk && !stale(onDisk)) return known[id] = onDisk;
			const before = onDisk ?? known[id];
			const name = await ask(owner, repo).catch(() => null);
			const entry = name ? {
				at: now(),
				name
			} : {
				at: now(),
				...before?.name && { name: before.name },
				failures: (before?.failures ?? 0) + 1
			};
			known[id] = entry;
			await writeEntry(file, id, entry).catch(() => {});
			return entry;
		})().finally(() => asking.delete(id));
		asking.set(id, done);
		return done;
	};
	const current = async (project) => {
		const m = /^github\.com\/([^/]+)\/([^/]+)$/.exec(project.id);
		if (!m) return project;
		let entry = (await load())[project.id];
		if (ask && !entry) entry = await refresh(project.id, m[1], m[2]);
		else if (ask && stale(entry)) refresh(project.id, m[1], m[2]).catch(() => {});
		const name = entry?.name;
		if (!name || name.toLowerCase() === `${m[1]}/${m[2]}`) return project;
		return {
			id: `github.com/${name}`.toLowerCase(),
			name: name.split("/")[1]
		};
	};
	const projectOfUrl = (remote) => projectId(remote, {
		machine: "",
		root: ""
	});
	return {
		current,
		idOf: async (remote) => (await current(projectOfUrl(remote))).id,
		async urlOf(remote) {
			const was = projectOfUrl(remote);
			const now = await current(was);
			return now.id === was.id ? remote : renamedUrl(remote, now.id.slice(11));
		}
	};
}
function renamedUrl(remote, name) {
	const git = (p) => /\.git\/?$/.test(p) ? ".git" : "";
	if (remote.includes("://")) {
		const url = new URL(remote);
		url.pathname = `/${name}${git(url.pathname)}`;
		return url.toString();
	}
	return remote.replace(/:([^:]*)$/, (_, p) => `:${name}${git(p)}`);
}
async function readEntries(file) {
	const parsed = await fs.readFile(file, "utf8").then((text) => JSON.parse(text), () => null);
	const out = {};
	if (!parsed || typeof parsed !== "object") return out;
	for (const [id, e] of Object.entries(parsed)) {
		if (!e || typeof e.at !== "number") continue;
		out[id] = {
			at: e.at,
			...typeof e.name === "string" && { name: e.name },
			...typeof e.failures === "number" && e.failures > 0 && { failures: e.failures }
		};
	}
	return out;
}
async function writeEntry(file, id, entry) {
	const all = {
		...await readEntries(file),
		[id]: entry
	};
	await fs.mkdir(path.dirname(file), { recursive: true });
	const temp = `${file}.${process.pid}.tmp`;
	await fs.writeFile(temp, JSON.stringify(all, null, 2) + "\n");
	await fs.rename(temp, file).catch(async (err) => {
		await fs.rm(temp, { force: true }).catch(() => {});
		throw err;
	});
}
/** The resolver a one-shot command uses: it only reads the cache. */
const cachedRemoteNames = (claudeDir) => remoteNames({ file: remoteNamesPath(claudeDir) });
//#endregion
//#region src/runner/prompts.ts
async function loadPrompts(dir) {
	const read = async (name) => (await fs.readFile(path.join(dir, name), "utf8")).trim();
	return {
		instructions: await read("instructions.md"),
		question: await read("question.md"),
		brief: await read("brief.md"),
		spinOff: await read("spin-off.md")
	};
}
/** `template` with each {{key}} replaced by its value; an unknown key is left as it is. */
function fill(template, values) {
	return template.replace(/\{\{(\w+)\}\}/g, (whole, key) => Object.hasOwn(values, key) ? values[key] : whole);
}
//#endregion
//#region src/runner/scan.ts
/** What `scan` names as the match when the patterns couldn't be read. */
const UNREADABLE = "unreadable patterns: everything is held";
/** The patterns in `file`: [] when the owner's is missing, and null, logged, when it can't be used. */
async function readPatterns(file, optional, log) {
	const unusable = (why) => {
		if (!optional) throw new Error(`${file}: ${why}`);
		log(`${file} can't be used, so every answer, brief and report is held: ${why}`);
		return null;
	};
	let value;
	try {
		value = JSON.parse(await fs.readFile(file, "utf8"));
	} catch (err) {
		if (optional && err.code === "ENOENT") return [];
		if (!optional) throw err;
		return unusable(err.message);
	}
	const list = value?.patterns;
	if (!Array.isArray(list)) return unusable("it has no \"patterns\" list");
	const out = [];
	for (const p of list) {
		const name = typeof p?.name === "string" && p.name ? p.name : String(p?.regex);
		try {
			if (typeof p?.regex !== "string" || !p.regex) throw new Error("no regex");
			const flags = typeof p.flags === "string" ? p.flags : "";
			if (!/^[imsu]*$/.test(flags)) throw new Error(`flags "${flags}" aren't any of i, m, s and u`);
			out.push({
				name,
				regex: new RegExp(p.regex, flags)
			});
		} catch (err) {
			return unusable(`the secret pattern "${name}" doesn't compile: ${err.message}`);
		}
	}
	return out;
}
/** The mod's patterns and the owner's, or null when the owner's can't be used. */
async function loadPatterns(modFile, ownerFile, log) {
	const mod = await readPatterns(modFile, false, log);
	const owner = await readPatterns(ownerFile, true, log);
	return owner && [...mod, ...owner];
}
/** The name of the first pattern `text` matches, or null when it matches none; UNREADABLE when `patterns` is null. */
function scan(text, patterns) {
	if (!patterns) return UNREADABLE;
	return patterns.find((p) => p.regex.test(text))?.name ?? null;
}
//#endregion
//#region src/handoff/connection.ts
async function openSideLink(url, hello, timeoutMs) {
	const ws = new WebSocket(url);
	const inbox = [];
	let wake = () => {};
	let closed = false;
	ws.onmessage = (event) => {
		let value;
		try {
			value = JSON.parse(String(event.data));
		} catch {
			return;
		}
		const parsed = parseOfficeServerMessage(value);
		if (parsed.ok) inbox.push(parsed.message);
		wake();
	};
	ws.onclose = () => {
		closed = true;
		wake();
	};
	await new Promise((resolve, reject) => {
		const timer = setTimeout(() => (ws.close(), reject(/* @__PURE__ */ new Error(`couldn't reach the office server at ${url}`))), timeoutMs);
		ws.onopen = () => (clearTimeout(timer), resolve());
		ws.onerror = () => (clearTimeout(timer), reject(/* @__PURE__ */ new Error(`couldn't reach the office server at ${url}`)));
	});
	ws.onerror = () => {};
	ws.send(JSON.stringify(hello));
	return {
		send: (message) => ws.send(JSON.stringify(message)),
		async next(wanted, ms) {
			const end = Date.now() + ms;
			for (;;) {
				const i = inbox.findIndex((m) => m.type === "error" || wanted(m));
				if (i >= 0) return inbox.splice(i, 1)[0];
				if (closed) throw new Error("the office server closed the link");
				const left = end - Date.now();
				if (left <= 0) throw new Error("the office server didn't answer in time");
				await new Promise((resolve) => {
					const timer = setTimeout(resolve, left);
					wake = () => (clearTimeout(timer), resolve());
				});
			}
		},
		async close() {
			if (closed) return;
			let timer;
			const gone = new Promise((resolve) => ws.onclose = () => resolve());
			ws.close();
			await Promise.race([gone, new Promise((r) => timer = setTimeout(r, 2e3))]);
			clearTimeout(timer);
		}
	};
}
/** What a command is told when this machine has to be paired (again) before the office takes it (#23). */
const NEEDS_PAIRING = "This machine needs pairing with the office before it takes this: open Claude Code on this computer to see its \"Pair this machine\" link in the status line, approve it in the office, then run this again.";
/** What a command is told when the office server refuses its hello for this machine's pairing. */
const PAIRING_REFUSED = {
	"not-paired": NEEDS_PAIRING,
	"pairing-ended": `This machine's pairing with the office has ended (it was revoked, or it lapsed). ${NEEDS_PAIRING}`,
	"forged-hello": "The office server says another paired machine reports this session, so it won't take this from here."
};
/** The office server refused the command's hello for this machine's pairing; the message says what to do. */
var PairingRefused = class extends Error {};
/**
* Opens a side link as this machine's pairing and sends `first`, returning the link and the first
* answer `wanted` accepts (or the server's error). A hello refused as token-expired is tried once
* more with a renewed token: the server reads nothing after a hello it refuses, so `first` hadn't
* been acted on. A refusal for the pairing itself throws PairingRefused, saying what to do.
*/
async function openPairedLink(url, hello, pairing, first, wanted, timeoutMs) {
	for (let renewed = false;; renewed = true) {
		const token = await pairing.token(renewed);
		const link = await openSideLink(url, token ? {
			...hello,
			token
		} : hello, timeoutMs);
		let answer;
		try {
			link.send(first);
			answer = await link.next(wanted, timeoutMs);
		} catch (err) {
			await link.close();
			throw err;
		}
		const code = answer.type === "error" ? answer.code : null;
		if (code !== "token-expired" && code !== "not-paired" && code !== "pairing-ended" && code !== "forged-hello") return {
			link,
			answer
		};
		await link.close();
		if (code === "token-expired" && token && !renewed) continue;
		throw new PairingRefused(code !== "token-expired" ? PAIRING_REFUSED[code] : token ? `The office server refused this machine's token, even renewed. ${NEEDS_PAIRING}` : `The office server says this machine's token has run out, though none was sent: this machine holds no pairing for it. ${NEEDS_PAIRING}`);
	}
}
new TextEncoder();
new TextEncoder();
//#endregion
//#region src/runner/claude.ts
/** Ends a process and everything it started: on Windows `kill` reaches only the process itself. */
function killTree(child, platform = process.platform) {
	if (child.exitCode !== null || child.signalCode !== null || child.pid === void 0) return;
	killPid(child.pid, platform, () => child.kill("SIGKILL"));
}
/**
* Ends the process `pid` and everything it started, as killTree does, for a process this runner
* didn't start itself (one an earlier run left, from the process registry). Off Windows the process
* leads its own group (spawned detached); `fallback` runs when it doesn't, and by default kills the
* process alone.
*/
function killPid(pid, platform = process.platform, fallback = () => process.kill(pid, "SIGKILL")) {
	if (platform === "win32") spawnSync("taskkill", [
		"/pid",
		String(pid),
		"/T",
		"/F"
	], {
		windowsHide: true,
		stdio: "ignore"
	});
	else try {
		process.kill(-pid, "SIGKILL");
	} catch {
		try {
			fallback();
		} catch {}
	}
}
//#endregion
//#region src/handoff/git.ts
/** A new handoff id: short, and safe in a branch name. */
const newHandoffId = () => randomBytes(5).toString("hex");
/** The handoff's branch. */
const handoffBranch = (id) => `isoplan/handoff/${id}`;
var HandoffGitError = class extends Error {
	kind;
	detail;
	repo;
	pushed;
	constructor(kind, detail, repo = ".", pushed = []) {
		super(detail);
		this.kind = kind;
		this.detail = detail;
		this.repo = repo;
		this.pushed = pushed;
	}
};
/** What the server is told for each kind of git failure. */
const GIT_FAILED = {
	"not-a-repo": "the session's folder isn't in a git repo, and has none in it",
	"too-wide": "the session's folder is the home folder or a drive's root, too wide a folder to hand over from",
	"no-work": "none of the repos in the session's folder has work that isn't on its default branch",
	"not-in-office": "none of the repos with work in the session's folder is one the office takes",
	"no-commit": "the session's repo has no commit to hand over from",
	"no-remote": "the session's repo has no remote to push the handoff's branch to",
	lfs: "the session's repo uses Git LFS, whose files a handoff can't push yet",
	"timed-out": "git took too long to push the handoff's branch",
	rejected: "the remote rejected the handoff's branch",
	failed: "git couldn't push the handoff's branch"
};
/**
* What the server is told for a git failure: naming the repo when it is one under the session's
* folder, and the repos already pushed when some were, which handing over again finishes.
*/
const gitFailed = (err) => {
	const text = GIT_FAILED[err.kind];
	const said = err.repo === "." ? text : `${text.replace("the session's repo", "a repo in the session's folder")} (in ${err.repo})`;
	return err.pushed.length ? `${said}; the branch was pushed already in ${err.pushed.join(", ")}, and handing it over again with the same id pushes the rest` : said;
};
const REPO_VARIABLES = [
	"GIT_DIR",
	"GIT_WORK_TREE",
	"GIT_INDEX_FILE",
	"GIT_COMMON_DIR",
	"GIT_OBJECT_DIRECTORY",
	"GIT_NAMESPACE"
];
/**
* The environment git runs with: no terminal prompt and no credential manager window; ssh in batch
* mode, unless the person chose their own ssh (GIT_SSH_COMMAND, GIT_SSH, or core.sshCommand in the
* repo's config, `sshCommandSet`); and none of the inherited variables that would point it at
* another repo.
*/
function noPromptEnv(env, sshCommandSet = false) {
	const out = {};
	for (const [key, value] of Object.entries(env)) if (value !== void 0 && !REPO_VARIABLES.includes(key.toUpperCase())) out[key] = value;
	out.GIT_TERMINAL_PROMPT = "0";
	out.GCM_INTERACTIVE = "never";
	if (!out.GIT_SSH_COMMAND && !out.GIT_SSH && !sshCommandSet) out.GIT_SSH_COMMAND = "ssh -o BatchMode=yes";
	return out;
}
function spawnGit(args, cwd, env, timeoutMs) {
	return new Promise((resolve) => {
		let stdout = "";
		let stderr = "";
		let timedOut = false;
		const child = spawn("git", args, {
			cwd,
			env,
			stdio: [
				"pipe",
				"pipe",
				"pipe"
			],
			windowsHide: true,
			detached: process.platform !== "win32"
		});
		child.stdin.end();
		child.stdout.setEncoding("utf8").on("data", (piece) => stdout += piece);
		child.stderr.setEncoding("utf8").on("data", (piece) => stderr = (stderr + piece).slice(-2e3));
		const timer = setTimeout(() => {
			timedOut = true;
			killTree(child);
		}, timeoutMs);
		child.on("error", (err) => {
			clearTimeout(timer);
			resolve({
				code: null,
				stdout,
				stderr: err.message,
				timedOut
			});
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			resolve({
				code,
				stdout,
				stderr,
				timedOut
			});
		});
	});
}
function createRunGit(baseEnv = process.env) {
	const sshCommand = /* @__PURE__ */ new Map();
	return async (args, { cwd, env, timeoutMs }) => {
		const key = pathKey(cwd);
		if (!sshCommand.has(key)) sshCommand.set(key, spawnGit([
			"config",
			"--get",
			"core.sshCommand"
		], cwd, noPromptEnv(baseEnv, true), timeoutMs).then((r) => r.code === 0 && r.stdout.trim() !== ""));
		return spawnGit(args, cwd, {
			...noPromptEnv(baseEnv, await sshCommand.get(key)),
			...env
		}, timeoutMs);
	};
}
/** A remote URL with any user name and password taken out, so a token in it never leaves. */
function withoutCredentials(remote) {
	return remote.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@]*@/i, "$1");
}
/** Whether two remote URLs name the same repository: the same project id, or the same local path. */
function sameRemote(a, b) {
	const local = {
		machine: "",
		root: ""
	};
	const pa = projectId(withoutCredentials(a), local).id;
	const pb = projectId(withoutCredentials(b), local).id;
	if (!pa.startsWith("local:") || !pb.startsWith("local:")) return pa === pb;
	const asPath = (r) => pathKey(path.resolve(r.replace(/^file:\/\//, ""))).replace(/(\/\.git|\.git)$/, "");
	return asPath(a) === asPath(b);
}
/** Whether two remote URLs name the same repository, an old and the current name of one GitHub repo counted as one (remote-names.ts). */
async function sameRepo(a, b, names = null) {
	if (sameRemote(a, b)) return true;
	return !!names && await names.idOf(withoutCredentials(a)) === await names.idOf(withoutCredentials(b));
}
/** The repo's remotes with their fetch and push URLs (which may hold spaces: a local path). */
async function remotesOf(run, cwd, timeoutMs) {
	const r = await run([
		"config",
		"--local",
		"--get-regexp",
		"^remote\\..*\\.(url|pushurl)$"
	], {
		cwd,
		timeoutMs
	});
	if (r.code !== 0) return r.code === 1 ? [] : null;
	const out = /* @__PURE__ */ new Map();
	for (const line of r.stdout.split(/\r?\n/)) {
		const m = /^remote\.(.+)\.(?:url|pushurl) (.*)$/.exec(line);
		if (m) out.set(m[1], [...out.get(m[1]) ?? [], m[2]]);
	}
	return [...out].map(([name, urls]) => ({
		name,
		urls
	}));
}
const UNTRACKED_MAX = 50;
/**
* The untracked files in the repo at `cwd` that .gitignore doesn't match, by path from the repo's
* top; null when git couldn't list them. Files git ignores are never listed.
*/
async function untracked(run, cwd, timeoutMs) {
	const r = await run([
		"ls-files",
		"--others",
		"--exclude-standard",
		"--full-name",
		"-z",
		":/"
	], {
		cwd,
		timeoutMs
	});
	if (r.code !== 0) return null;
	return r.stdout.split("\0").filter(Boolean).sort();
}
const listed = (files) => files.slice(0, UNTRACKED_MAX).map((f) => `\`${f}\``).join(", ") + (files.length > UNTRACKED_MAX ? `, and ${files.length - UNTRACKED_MAX} more` : "");
/** The brief request's last line: the untracked files the brief should say the purpose of. */
const untrackedLine = (files) => files === null ? "The untracked files couldn't be listed, so don't name any." : files.length ? `The untracked files are: ${listed(files)}. Say what each is for.` : "There are no untracked files.";
/** A repo's handoff branch: isoplan/handoff/<id>, or with its own suffix when it shares a remote with an earlier one. */
const repoBranch = (id, repo) => repo.suffix ? `${handoffBranch(id)}--${repo.suffix}` : handoffBranch(id);
/**
* The runner's note at the end of every brief: what is pushed, from where, and what isn't, as of
* `at` (a brief withheld and released later still describes the tree as it was then). With repos
* under the session's folder, it names each by its path there.
*/
function handoffNote({ branch, from, files, at, repos = [], left = [] }) {
	const when = at.toISOString().slice(0, 16).replace("T", " ") + " UTC";
	const each = (r) => {
		const said = [r.from ? `made from ${r.from}` : "", r.suffix ? `on ${branch}--${r.suffix}, since it pushes to the same remote as a repo before it` : ""].filter(Boolean).join(", ");
		return `\`${r.path}\`${said ? ` (${said})` : ""}`;
	};
	const lines = repos.some((r) => r.path !== ".") ? [`Handed over by Isoplan on the branch ${branch} in each of these repos, by their paths in the session's folder, with each one's tracked changes in a work-in-progress commit: ${repos.map(each).join(", ")}. This describes the work trees as of ${when}.`] : [`Handed over by Isoplan on the branch ${branch}${from ? `, made from ${from}` : ""}, with the tracked changes in a work-in-progress commit. This describes the work tree as of ${when}.`];
	for (const why of new Set(left.map((l) => l.why))) lines.push(`Not handed over, ${why}: ${listed(left.filter((l) => l.why === why).map((l) => l.path))}.`);
	if (files === null) lines.push("Untracked files: unknown, since git couldn't list them.");
	else if (files.length) lines.push(`Untracked files, not handed over: ${listed(files)}.`);
	return lines.join("\n");
}
const WHY = {
	unchanged: "since they have no work that isn't on their remote's default branch",
	"no-commit": "since they have no commit yet",
	"no-remote": "since they have no remote to push to",
	submodule: "since they are git submodules, which a handoff doesn't carry",
	unreadable: "since git couldn't read them",
	slow: "since git took too long in them",
	deep: "since they are deeper than repoSearchDepth",
	dot: "since their folders' names start with a dot, which aren't looked in",
	modules: "since they are node_modules folders, which aren't looked in",
	link: "since they are reached through a link, which isn't followed",
	folder: "since these folders couldn't be read, so any repos in them weren't looked for"
};
function gitIn(run, cwd, timeoutMs, repo) {
	const git = async (args, env) => {
		const r = await run(args, {
			cwd,
			timeoutMs,
			env
		});
		if (r.timedOut) throw new HandoffGitError("timed-out", `git ${args[0]} in ${cwd} took longer than ${Math.round(timeoutMs / 1e3)} s`, repo);
		return r;
	};
	const must = async (args, kind = "failed", env) => {
		const r = await git(args, env);
		if (r.code !== 0) throw new HandoffGitError(kind, `git ${args.join(" ")} in ${cwd}: ${r.stderr.trim()}`, repo);
		return r.stdout.trim();
	};
	return {
		git,
		must
	};
}
/**
* The folders under `root` that hold a repo (a `.git` folder or file), by path from it, at most
* `depth` folders down; and what wasn't looked in, by why, when it holds a repo itself: a folder
* whose name starts with a dot, node_modules, a link, or one a level past `depth`, and any folder
* that couldn't be read. With `loose`, the files outside every repo too, by path from `root`.
*/
async function reposUnder(root, depth, loose = false) {
	const found = [];
	const skipped = [];
	const files = [];
	const holdsGit = (sub) => fs.stat(path.join(root, sub, ".git")).then(() => true, () => false);
	const walk = async (rel, level, inRepo) => {
		let entries;
		try {
			entries = await fs.readdir(path.join(root, rel), { withFileTypes: true });
		} catch {
			if (rel) skipped.push({
				path: rel,
				why: WHY.folder
			});
			return;
		}
		for (const entry of entries.sort((a, b) => a.name < b.name ? -1 : 1)) {
			const sub = rel ? `${rel}/${entry.name}` : entry.name;
			const why = entry.isSymbolicLink() ? WHY.link : !entry.isDirectory() || entry.name === ".git" ? null : entry.name.startsWith(".") ? WHY.dot : entry.name === "node_modules" ? WHY.modules : level >= depth ? WHY.deep : "";
			if (why === null) {
				if (loose && !inRepo && !entry.isDirectory()) files.push(sub);
				continue;
			}
			if (why) {
				if (await holdsGit(sub)) skipped.push({
					path: sub,
					why
				});
				continue;
			}
			const repo = await holdsGit(sub);
			if (repo) found.push(sub);
			await walk(sub, level + 1, inRepo || repo);
		}
	};
	await walk("", 0, false);
	return {
		found,
		skipped,
		files
	};
}
/** The current branch, or null when HEAD is detached. */
async function branchOf(run, dir, timeoutMs, repo) {
	const head = await gitIn(run, dir, timeoutMs, repo).git([
		"symbolic-ref",
		"--short",
		"-q",
		"HEAD"
	]);
	return head.code === 0 && head.stdout.trim() ? head.stdout.trim() : null;
}
/** The remote `from` pushes to (branch.<x>.pushRemote, remote.pushDefault, then branch.<x>.remote), else origin, else the only remote there is. */
async function pushRemote(run, dir, from, timeoutMs, repo) {
	const { git, must } = gitIn(run, dir, timeoutMs, repo);
	const remotes = (await must(["remote"])).split(/\r?\n/).filter(Boolean);
	const setting = async (key) => (await git([
		"config",
		"--get",
		key
	])).stdout.trim();
	return {
		remote: [
			from ? await setting(`branch.${from}.pushRemote`) : "",
			await setting("remote.pushDefault"),
			from ? await setting(`branch.${from}.remote`) : ""
		].find((r) => remotes.includes(r)) ?? (remotes.includes("origin") ? "origin" : remotes.length === 1 ? remotes[0] : null),
		remotes
	};
}
async function inspect(run, dir, repo, timeoutMs) {
	const { git, must } = gitIn(run, dir, timeoutMs, repo);
	const top = await git(["rev-parse", "--show-toplevel"]);
	if (top.code !== 0 || pathKey(top.stdout.trim()) !== pathKey(dir)) return "unreadable";
	if ((await git([
		"rev-parse",
		"--verify",
		"-q",
		"HEAD"
	])).code !== 0) return "no-commit";
	const from = await branchOf(run, dir, timeoutMs, repo);
	const { remote } = await pushRemote(run, dir, from, timeoutMs, repo);
	if (!remote) return (await git([
		"status",
		"--porcelain",
		"--untracked-files=no"
	])).stdout.trim() ? "no-remote" : null;
	const found = {
		path: repo,
		dir,
		from,
		remote,
		url: await must([
			"remote",
			"get-url",
			"--push",
			remote
		])
	};
	if ((await git([
		"status",
		"--porcelain",
		"--untracked-files=no"
	])).stdout.trim()) return found;
	const fallback = (await git([
		"symbolic-ref",
		"-q",
		`refs/remotes/${remote}/HEAD`
	])).stdout.trim();
	const upstream = (await git([
		"rev-parse",
		"--verify",
		"-q",
		"--symbolic-full-name",
		"@{upstream}"
	])).stdout.trim();
	const ahead = await git([
		"rev-list",
		"--count",
		"HEAD",
		"--not",
		...fallback ? [fallback] : [...remoteOwn(remote), ...upstream ? [upstream] : []]
	]);
	return ahead.code !== 0 || Number(ahead.stdout.trim()) > 0 ? found : "unchanged";
}
const remoteOwn = (remote) => [`--exclude=${remote}/isoplan/handoff/*`, `--remotes=${remote}`];
const tooWide = (dir, home) => pathKey(dir) === pathKey(home) || path.parse(path.resolve(dir)).root === path.resolve(dir);
const slug = (p) => p.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "") || "repo";
/**
* What a handoff from `cwd` would start from: the session's folder, the repos in it to hand over
* with where each pushes, their untracked files and what is left out. The folder's own repo failing
* throws a HandoffGitError; a repo under it that git can't read is left out, with why.
*/
async function prepare(run, cwd, timeoutMs, depth = 3, home = os.homedir(), takes) {
	const top = await run(["rev-parse", "--show-toplevel"], {
		cwd,
		timeoutMs
	});
	if (top.timedOut) throw new HandoffGitError("timed-out", `git rev-parse in ${cwd} took longer than ${Math.round(timeoutMs / 1e3)} s`);
	const inRepo = top.code === 0;
	const toplevel = inRepo ? top.stdout.trim() : path.resolve(cwd);
	if (tooWide(toplevel, home)) throw new HandoffGitError("too-wide", `${toplevel} is the home folder or a drive's root, so repos aren't looked for under it`);
	const { found, skipped, files: loose } = await reposUnder(toplevel, depth, !inRepo);
	if (!inRepo && !found.length) throw new HandoffGitError("not-a-repo", `${cwd} isn't in a git repo and has none under it: ${top.stderr.trim()}`);
	const dirOf = (p) => p === "." ? toplevel : path.join(toplevel, p);
	const from = inRepo ? await branchOf(run, toplevel, timeoutMs, ".") : null;
	const repos = [];
	const notInOffice = [];
	if (inRepo && takes && !await takes(toplevel)) throw new HandoffGitError("not-in-office", `${toplevel} isn't a repo the office takes`);
	if (inRepo) {
		const { remote, remotes } = await pushRemote(run, toplevel, from, timeoutMs, ".");
		if (!remote) throw new HandoffGitError("no-remote", `${toplevel} has ${remotes.length ? `several remotes and none is origin: ${remotes.join(", ")}` : "no remote"}`);
		repos.push({
			path: ".",
			dir: toplevel,
			from,
			remote,
			url: await gitIn(run, toplevel, timeoutMs, ".").must([
				"remote",
				"get-url",
				"--push",
				remote
			], "no-remote")
		});
	}
	const left = [...skipped];
	const listedRepos = inRepo ? ["."] : [];
	for (const sub of found) {
		if (notInOffice.some((p) => sub.startsWith(`${p}/`))) continue;
		if (takes && !await takes(dirOf(sub))) {
			notInOffice.push(sub);
			continue;
		}
		try {
			const above = [...inRepo ? ["."] : [], ...found].filter((p) => p === "." || sub.startsWith(`${p}/`)).sort((a, b) => a.length - b.length).at(-1);
			if (above) {
				const inside = above === "." ? sub : sub.slice(above.length + 1);
				if ((await gitIn(run, dirOf(above), timeoutMs, above).git([
					"--literal-pathspecs",
					"ls-files",
					"--stage",
					"--",
					inside
				])).stdout.startsWith("160000 ")) {
					left.push({
						path: sub,
						why: WHY.submodule
					});
					continue;
				}
			}
			const state = await inspect(run, dirOf(sub), sub, timeoutMs);
			if (typeof state === "string") left.push({
				path: sub,
				why: WHY[state]
			});
			else if (state) repos.push(state);
			if (state !== "unreadable") listedRepos.push(sub);
		} catch (err) {
			if (!(err instanceof HandoffGitError)) throw err;
			left.push({
				path: sub,
				why: err.kind === "timed-out" ? WHY.slow : WHY.unreadable
			});
		}
	}
	if (!repos.length && notInOffice.length) throw new HandoffGitError("not-in-office", `none of the repos with work under ${toplevel} is one the office takes: ${notInOffice.join(", ")}`);
	if (!repos.length) throw new HandoffGitError("no-work", `none of the repos under ${toplevel} has work that isn't on its remote's default branch`);
	const suffixes = /* @__PURE__ */ new Set();
	const prepared = repos.map((r, i) => {
		if (!repos.slice(0, i).some((o) => sameRemote(o.url, r.url))) return {
			...r,
			suffix: null
		};
		let suffix = slug(r.path);
		for (let n = 2; suffixes.has(suffix); n++) suffix = `${slug(r.path)}-${n}`;
		suffixes.add(suffix);
		return {
			...r,
			suffix
		};
	});
	let files = takes && !inRepo ? [] : [...loose];
	for (const p of listedRepos) {
		const own = await untracked(run, dirOf(p), timeoutMs);
		if (own === null) {
			files = null;
			break;
		}
		const full = own.map((f) => p === "." ? f : `${p}/${f}`);
		files.push(...full.filter((f) => !found.some((sub) => f === `${sub}/`)));
	}
	const taken = (p) => {
		const owner = [...repos.map((r) => r.path), ...notInOffice].filter((r) => r === "." || p === r || p.startsWith(`${r}/`)).sort((a, b) => b.length - a.length)[0];
		return owner !== void 0 && !notInOffice.includes(owner);
	};
	const kept = takes ? left.filter((l) => taken(l.path)) : left;
	return {
		toplevel,
		from,
		files: files && files.sort(),
		repos: prepared,
		left: kept,
		notInOffice
	};
}
/**
* The files a patch (`git log -p -U0`) adds lines to, with those lines, and the binary files it adds
* or changes, which can't be read. A `+++ ` line is a file's header only right after its `--- `
* line; anywhere else it is an added line that starts with `++`.
*/
function addedLines(diff) {
	const lines = /* @__PURE__ */ new Map();
	const binary = /* @__PURE__ */ new Set();
	let file = null;
	let previous = "";
	for (const line of diff.split("\n")) {
		const header = line.startsWith("+++ ") && previous.startsWith("--- ");
		const bin = /^Binary files .* and (?:b\/)?(.+) differ$/.exec(line);
		if (header) file = line === "+++ /dev/null" ? null : line.slice(4).replace(/^b\//, "");
		else if (line.startsWith("diff --git ")) file = null;
		else if (bin && bin[1] !== "/dev/null") binary.add(bin[1]);
		else if (file && line.startsWith("+")) lines.set(file, (lines.get(file) ?? "") + line.slice(1) + "\n");
		previous = line;
	}
	return {
		lines,
		binary: [...binary].sort()
	};
}
const IDENTITY = {
	GIT_AUTHOR_NAME: "Isoplan handoff",
	GIT_AUTHOR_EMAIL: "handoff@isoplan.invalid",
	GIT_COMMITTER_NAME: "Isoplan handoff",
	GIT_COMMITTER_EMAIL: "handoff@isoplan.invalid"
};
/**
* Commits the tracked changes in each repo `prepare` finds at `cwd` and pushes that commit alone to
* its handoff branch (repoBranch), with force, since the branch is the handoff's own and a second
* hand-over of the same room replaces it. A repo's remote is the one its current branch pushes to
* (branch.<x>.pushRemote, remote.pushDefault, then branch.<x>.remote, then origin), and the repo it
* records names its push URL, where the branch is. Nothing is pushed until every repo's commit is
* made and scanned. A push that fails after others went names them. Throws a HandoffGitError.
*/
async function pushHandoff(run, cwd, id, timeoutMs, { scan, pushAnyway = {}, depth, prepared, takes, names } = {}) {
	const { repos } = prepared ?? await prepare(run, cwd, timeoutMs, depth, void 0, takes);
	const temp = await fs.mkdtemp(path.join(os.tmpdir(), "isoplan-handoff-"));
	const ready = [];
	try {
		for (const [n, repo] of repos.entries()) ready.push(await commitIn(run, repo, id, path.join(temp, `index-${n}`), timeoutMs, pushAnyway[repo.path] ?? null, scan));
	} finally {
		await fs.rm(temp, {
			recursive: true,
			force: true
		}).catch(() => {});
	}
	const held = ready.filter((r) => r.held.length);
	if (held.length) return {
		held: held.flatMap((r) => r.held),
		commits: Object.fromEntries(held.map((r) => [r.path, r.commit])),
		unchecked: ready.flatMap((r) => r.unchecked)
	};
	const pushed = [];
	for (const r of ready) {
		const { git } = gitIn(run, r.dir, timeoutMs, r.path);
		const done = pushed.map((p) => p.path);
		try {
			const sent = await git([
				"-c",
				"push.followTags=false",
				"-c",
				"push.recurseSubmodules=no",
				"push",
				"--no-verify",
				"--no-follow-tags",
				"--recurse-submodules=no",
				"--porcelain",
				r.remote,
				`+${r.commit}:refs/heads/${r.branch}`
			]);
			if (sent.code !== 0) throw new HandoffGitError(/rejected|denied|declined/i.test(sent.stderr + sent.stdout) ? "rejected" : "failed", `git push ${r.remote} ${r.branch} in ${r.dir}: ${(sent.stderr || sent.stdout).trim()}`, r.path, done);
		} catch (err) {
			if (err instanceof HandoffGitError && !err.pushed.length && done.length) throw new HandoffGitError(err.kind, err.detail, err.repo, done);
			throw err;
		}
		const remote = withoutCredentials(r.url);
		pushed.push({
			path: r.path,
			remote: names ? await names.urlOf(remote) : remote,
			branch: r.branch,
			commit: r.commit
		});
	}
	return { repos: pushed };
}
async function commitIn(run, repo, id, index, timeoutMs, pushAnyway, scan) {
	const { path: at, dir, from, remote } = repo;
	const { git, must } = gitIn(run, dir, timeoutMs, at);
	const inFolder = (file) => at === "." ? file : `${at}/${file}`;
	const branch = repoBranch(id, repo);
	const head = await git([
		"rev-parse",
		"--verify",
		"-q",
		"HEAD"
	]);
	if (head.code !== 0) throw new HandoffGitError("no-commit", `${dir} has no commit yet`, at);
	const parent = head.stdout.trim();
	const fallback = (await git([
		"symbolic-ref",
		"--short",
		"-q",
		`refs/remotes/${remote}/HEAD`
	])).stdout.trim().replace(`${remote}/`, "");
	if (branch === from || branch === fallback) throw new HandoffGitError("failed", `${branch} is the current or the default branch of ${dir}, which a handoff never pushes`, at);
	const lfs = async (commit) => {
		if ((await git([
			"grep",
			"-q",
			"-I",
			"filter=lfs",
			commit,
			"--",
			".gitattributes",
			"**/.gitattributes"
		])).code === 0) throw new HandoffGitError("lfs", `${dir} uses Git LFS`, at);
	};
	const ready = (commit, held = [], unchecked = []) => ({
		...repo,
		branch,
		commit,
		held,
		unchecked
	});
	if (pushAnyway) {
		if ((await git([
			"cat-file",
			"-e",
			`${pushAnyway}^{commit}`
		])).code !== 0) throw new HandoffGitError("failed", `the held commit ${pushAnyway} is gone from ${dir}`, at);
		await lfs(pushAnyway);
		return ready(pushAnyway);
	}
	const real = path.resolve(dir, await must([
		"rev-parse",
		"--git-path",
		"index"
	]));
	const copied = await fs.copyFile(real, index).then(() => true, () => false);
	const withIndex = { GIT_INDEX_FILE: index };
	if (!copied) await must(["read-tree", "HEAD"], "failed", withIndex);
	await must([
		"add",
		"-u",
		"--",
		":/"
	], "failed", withIndex);
	const tree = await must(["write-tree"], "failed", withIndex);
	let commit = parent;
	if (tree !== await must(["rev-parse", `${parent}^{tree}`])) {
		const named = (await git(["config", "user.email"])).code === 0;
		commit = await must([
			"-c",
			"commit.gpgSign=false",
			"commit-tree",
			"--no-gpg-sign",
			tree,
			"-p",
			parent,
			"-m",
			`WIP: Isoplan handoff ${id}\n\nThe tracked changes${from ? ` on ${from}` : ""}, handed over as they were.`
		], "failed", named ? void 0 : IDENTITY);
	}
	await lfs(commit);
	if (!scan) return ready(commit);
	const { lines, binary } = addedLines(await must([
		"log",
		"-p",
		"-U0",
		"--no-color",
		"--no-ext-diff",
		"--no-renames",
		"--diff-merges=first-parent",
		"--format=",
		commit,
		"--not",
		...remoteOwn(remote)
	]));
	const held = [];
	for (const [file, text] of lines) if (await scan(text)) held.push(inFolder(file));
	return ready(commit, held, binary.map(inFolder));
}
//#endregion
//#region src/handoff/take.ts
/** The repo's own labelled settings file, at its top. */
const REPO_CONFIG = "isoplan.json";
/** The handoff's folder on this machine: its brief, launcher and setup log. */
const handoffDir = (claudeDir, id) => path.join(claudeDir, "isoplan", "handoffs", id);
async function remoteFor(remotes, remote, names) {
	for (const r of remotes ?? []) for (const url of r.urls) if (await sameRepo(url, remote, names)) return r;
}
const tail = (text) => (text.length > 2e3 ? "…" + text.slice(-2e3) : text).trim();
/** `worktreeSetup` from isoplan.json's text, for this platform: null when it names no command here. Throws when malformed. */
function parseSetup(text, platform, defaultTimeoutMs) {
	const setup = JSON.parse(text)?.worktreeSetup;
	if (setup === void 0) return null;
	if (!setup || typeof setup !== "object") throw new Error(`"worktreeSetup" in ${REPO_CONFIG} must be an object`);
	const key = platform === "win32" ? "windows" : platform === "darwin" ? "mac" : "linux";
	const c = setup.command;
	const command = c && typeof c === "object" ? c[key] : c;
	if (command !== void 0 && (typeof command !== "string" || !command.trim())) throw new Error(`"worktreeSetup.command" in ${REPO_CONFIG} must be a command, or { "windows", "mac" } commands`);
	const t = setup.timeoutMinutes;
	if (t !== void 0 && !(typeof t === "number" && Number.isFinite(t) && t > 0)) throw new Error(`"worktreeSetup.timeoutMinutes" in ${REPO_CONFIG} must be a number of minutes above 0`);
	return command ? {
		command,
		timeoutMs: typeof t === "number" ? t * 6e4 : defaultTimeoutMs
	} : null;
}
/**
* isoplan.json from the remote's default branch, as this clone knows it, and never from any other
* branch. The default branch is `<remote>/HEAD`, else what the remote says its HEAD is; the branch
* is fetched so the file is current. `problem` says why it couldn't be read; `text` is null when
* the default branch has no isoplan.json.
*/
async function readSetupFile(run, clone, timeoutMs) {
	const git = (args) => run(args, {
		cwd: clone.dir,
		timeoutMs
	});
	let branch = (await git([
		"symbolic-ref",
		"-q",
		"--short",
		`refs/remotes/${clone.remote}/HEAD`
	])).stdout.trim().replace(`${clone.remote}/`, "");
	if (!branch) {
		const said = await git([
			"ls-remote",
			"--symref",
			clone.remote,
			"HEAD"
		]);
		branch = /^ref: refs\/heads\/(\S+)\s+HEAD$/m.exec(said.stdout)?.[1] ?? "";
	}
	if (!branch) return {
		text: null,
		problem: `Setup was skipped: ${clone.remote}'s default branch couldn't be told, so ${REPO_CONFIG} couldn't be read from it.`
	};
	const fetched = await git([
		"fetch",
		"-q",
		clone.remote,
		`+refs/heads/${branch}:refs/remotes/${clone.remote}/${branch}`
	]);
	if (fetched.code !== 0) return {
		text: null,
		problem: `Setup was skipped: ${clone.remote}/${branch} couldn't be fetched to read ${REPO_CONFIG}:\n${fetched.stderr}`
	};
	const shown = await git(["show", `refs/remotes/${clone.remote}/${branch}:${REPO_CONFIG}`]);
	return {
		text: shown.code === 0 ? shown.stdout : null,
		problem: null
	};
}
/** The setup command isoplan.json on the remote's default branch names for this platform, or null; never throws. */
async function setupCommand(run, clone, platform, timeoutMs) {
	const { text } = await readSetupFile(run, clone, timeoutMs);
	try {
		return text === null ? null : parseSetup(text, platform, 0)?.command ?? null;
	} catch {
		return null;
	}
}
/** The commits this machine took of a handoff before, which a re-take may move past. */
async function takenBefore(folder) {
	try {
		const { commits } = JSON.parse(await fs.readFile(path.join(folder, "taken.json"), "utf8"));
		return Array.isArray(commits) ? commits.filter((c) => typeof c === "string" && /^[0-9a-f]{40,64}$/.test(c)) : [];
	} catch {
		return [];
	}
}
async function recordTaken(folder, commit) {
	const commits = [.../* @__PURE__ */ new Set([...await takenBefore(folder), commit])].slice(-50);
	await fs.mkdir(folder, { recursive: true });
	await fs.writeFile(path.join(folder, "taken.json"), JSON.stringify({
		about: "The commits of this handoff taken on this machine, which a later take may replace.",
		commits
	}, null, 2) + "\n");
}
let emptyHooks = null;
const noHooks = async () => ["-c", `core.hooksPath=${await (emptyHooks ??= fs.mkdtemp(path.join(os.tmpdir(), "isoplan-no-hooks-")))}`];
/**
* How many commits `ref` has that neither the new tip nor any commit this machine took of the
* handoff before (`exempt`, which a new hand-over replaces) has: the receiver's own work. Null when
* git can't say.
*/
async function ahead(run, cwd, tip, exempt, ref, timeoutMs) {
	const known = [];
	for (const c of exempt) if ((await run([
		"cat-file",
		"-e",
		`${c}^{commit}`
	], {
		cwd,
		timeoutMs
	})).code === 0) known.push(c);
	const r = await run([
		"rev-list",
		"--count",
		ref,
		"--not",
		tip,
		...known
	], {
		cwd,
		timeoutMs
	});
	return r.code === 0 ? Number(r.stdout.trim()) : null;
}
/** What a ref points at now, or null. */
async function resolved(run, cwd, ref, timeoutMs) {
	const r = await run([
		"rev-parse",
		"--verify",
		"-q",
		ref
	], {
		cwd,
		timeoutMs
	});
	return r.code === 0 ? r.stdout.trim() : null;
}
/**
* The shortcut's checkout (/isoplan:take): the handoff's branch in the session's own folder, fetched
* from the remote there that is the handoff's, with the repo's hooks off. A folder with uncommitted
* changes to tracked files is left as it is, rather than carrying them over. A local branch of that
* name moves to the fetched tip, unless it has commits that are neither in the tip nor ones this
* machine took of the handoff before (recorded in `folder`), which would be lost: then it is left as
* it is. The repos under the folder (#56) follow, each at its path in the folder, cloned where
* missing, as on the floor; they are left alone when the folder's own repo fails. The folder is the
* session's repo's top, or the session's folder for a handoff from a plain folder; a session in one
* of the handoff's repos under the folder works from the folder above it, and a plain folder's
* handoff isn't taken inside some other repo. No setup script runs: the person, or their harness,
* set up this folder. Returns the failed steps, each with the end of git's output and the repo it
* was in when that is one under the folder, and the folder's own repo's remote name.
*/
async function checkoutHere(run, cwd, handoff, folder, timeoutMs, { cloneFrom = onTheWire, names = null } = {}) {
	const repo = handoff.repos.find((r) => r.path === ".");
	const subs = byDepth(handoff.repos.filter((r) => r.path !== "."));
	const refused = (output, remote = null) => ({
		failures: [{
			step: "checkout",
			output: tail(output)
		}],
		remote,
		dir: at ?? cwd
	});
	const top = await run(["rev-parse", "--show-toplevel"], {
		cwd,
		timeoutMs
	});
	const at = top.code === 0 ? top.stdout.trim() : null;
	let inside;
	for (const sub of at ? subs : []) {
		if (pathKey(path.join(aboveOf(at, sub.path), sub.path)) !== pathKey(at)) continue;
		if (await remoteFor(await remotesOf(run, at, timeoutMs), sub.remote, names)) inside = sub;
	}
	const base = inside ? aboveOf(at, inside.path) : at ?? cwd;
	let remote = null;
	if (repo) {
		const own = at ? await checkoutIn(run, base, repo, repo.branch, folder, timeoutMs, names) : {
			error: `${cwd} isn't in a git repo.`,
			remote: null
		};
		if (own.error) return refused(own.error, own.remote);
		remote = own.remote;
	} else if (at && !inside) return refused(`${cwd} is inside the repo at ${at}, which isn't one of this handoff's repos (${subs.map((r) => r.path).join(", ")}), so nothing was cloned into it. Take it from the folder that holds them, or an empty one.`);
	const failures = [];
	for (const sub of subs) {
		const failed = await repoAt(run, base, sub, folder, timeoutMs, cloneFrom, names);
		if (failed) failures.push({
			step: failed.step,
			repo: sub.path,
			output: tail(failed.error)
		});
	}
	return {
		failures,
		remote,
		dir: base
	};
}
async function checkoutIn(run, cwd, repo, branch, folder, timeoutMs, names) {
	const git = (args) => run(args, {
		cwd,
		timeoutMs
	});
	const checkout = (args) => run(args, {
		cwd,
		timeoutMs,
		env: NO_LFS
	});
	const remotes = await remotesOf(run, cwd, timeoutMs);
	const failed = (error, remote = null) => ({
		error,
		remote
	});
	if (!remotes) return failed(`${cwd} isn't in a git repo.`);
	const name = (await remoteFor(remotes, repo.remote, names))?.name;
	if (!name) return failed(`No remote of the repo in ${cwd} is ${repo.remote}, the repo the handoff was pushed to.`);
	if ((await git([
		"status",
		"--porcelain",
		"--untracked-files=no"
	])).stdout.trim()) return failed(`${cwd} has uncommitted changes to tracked files, so the handoff's branch wasn't checked out over them. Commit or stash them, then take it again.`, name);
	const tip = `refs/remotes/${name}/${branch}`;
	const fetched = await git([
		"fetch",
		name,
		`+refs/heads/${branch}:${tip}`
	]);
	if (fetched.code !== 0) return failed(`git fetch ${name} ${branch}: ${fetched.stderr}`, name);
	const hooksOff = await noHooks();
	const ok = async () => {
		await recordTaken(folder, await resolved(run, cwd, "HEAD", timeoutMs) ?? repo.commit);
		return {
			error: null,
			remote: name
		};
	};
	if ((await git([
		"rev-parse",
		"--verify",
		"-q",
		`refs/heads/${branch}`
	])).code !== 0) {
		const switched = await checkout([
			...hooksOff,
			"switch",
			"--track",
			"-c",
			branch,
			`${name}/${branch}`
		]);
		return switched.code === 0 ? ok() : failed(`git switch ${branch}: ${switched.stderr}`, name);
	}
	const extra = await ahead(run, cwd, tip, await takenBefore(folder), `refs/heads/${branch}`, timeoutMs);
	if (extra !== 0) return failed(`The local branch ${branch} has ${extra ?? "some"} commit(s) that aren't in the handoff as handed over now, so it was left as it is. Merge or rebase them onto ${name}/${branch} yourself.`, name);
	const switched = await checkout([
		...hooksOff,
		"switch",
		branch
	]);
	if (switched.code !== 0) return failed(`git switch ${branch}: ${switched.stderr}`, name);
	const moved = await checkout([
		...hooksOff,
		"reset",
		"-q",
		"--keep",
		tip
	]);
	return moved.code === 0 ? ok() : failed(`${branch} couldn't be moved to the handoff as handed over now:\n${moved.stderr}`, name);
}
const byDepth = (repos) => [...repos].sort((a, b) => a.path.split("/").length - b.path.split("/").length);
const aboveOf = (at, p) => path.resolve(at, ...p.split("/").map(() => ".."));
/**
* Whether a missing repo may be cloned from `remote`: https, ssh or scp-style (host:path) only, so
* a handoff never points git at a local path, a file:// URL or a \\server share on this machine.
*/
function onTheWire(remote) {
	const url = /^([a-z][a-z0-9+.-]*):\/\//i.exec(remote);
	if (url) return [
		"https",
		"ssh",
		"git+ssh",
		"ssh+git"
	].includes(url[1].toLowerCase());
	const scp = /^([^/\\]*):/.exec(remote);
	return !!scp && scp[1].length > 1 && !remote.startsWith("\\");
}
const realpathNative = promisify(realpath.native);
const NO_LFS = { GIT_LFS_SKIP_SMUDGE: "1" };
function badPath(p) {
	const parts = p.split(/[\\/]/);
	if (parts.some(isGitFolder)) return `${p} is inside a .git folder`;
	if (p.includes(":")) return `${p} has a colon in it, which Windows reads as a drive or a file's stream`;
	if (path.isAbsolute(p) || parts.some((part) => part === "" || part === "." || part === "..")) return `${p} isn't a path of named folders inside the folder`;
	return null;
}
/**
* A repo under the folder (#56) on its handoff branch at its path in `base`: switched where a clone
* of it is there, cloned where there is nothing or an empty folder, from a remote `cloneFrom`
* allows, with Git LFS's download off (a handoff never carries LFS files). The failed step,
* `clone` when git clone failed and `checkout` otherwise, with its error; else null.
*/
async function repoAt(run, base, repo, folder, timeoutMs, cloneFrom, names) {
	const refused = (error) => ({
		step: "checkout",
		error
	});
	const bad = badPath(repo.path);
	if (bad) return refused(`${bad}, so nothing was checked out there.`);
	const target = path.join(base, repo.path);
	let existing = target;
	while (!await fs.lstat(existing).then(() => true, () => false)) existing = path.dirname(existing);
	const realBase = await realpathNative(base);
	const real = await realpathNative(existing);
	if (pathKey(real) !== pathKey(path.join(realBase, path.relative(base, existing)))) return refused(`${target} leads outside ${base} through a link, so nothing was checked out there.`);
	if (path.relative(realBase, real).split(/[\\/]/).some(isGitFolder)) return refused(`${repo.path} is inside a .git folder, so nothing was checked out there.`);
	const st = await fs.lstat(target).catch(() => null);
	if (st && !st.isDirectory()) return refused(`${target} is there already and isn't a folder, so ${repo.remote} wasn't cloned there.`);
	if (!st || (await fs.readdir(target)).length === 0) {
		if (!cloneFrom(repo.remote)) return refused(`${repo.path} isn't here, and ${repo.remote} isn't an https, ssh or host:path remote, so it wasn't cloned: a handoff never clones from a local path, a file:// URL or a \\\\server share. Clone it at ${target} yourself, then take the handoff again.`);
		await fs.mkdir(path.dirname(target), { recursive: true });
		const cloned = await run([
			...await noHooks(),
			"clone",
			"-q",
			"--branch",
			repo.branch,
			"--",
			repo.remote,
			target
		], {
			cwd: base,
			timeoutMs,
			env: NO_LFS
		});
		if (cloned.code !== 0) return {
			step: "clone",
			error: `git clone ${repo.remote} ${repo.path} failed${cloned.timedOut ? " (it took too long)" : ""}:\n${cloned.stderr}`
		};
		await recordTaken(folder, await resolved(run, target, "HEAD", timeoutMs) ?? repo.commit);
		return null;
	}
	const top = await run(["rev-parse", "--show-toplevel"], {
		cwd: target,
		timeoutMs
	});
	if (top.code !== 0 || pathKey(top.stdout.trim()) !== pathKey(target)) return refused(`${target} is there already and isn't a repo of its own, so ${repo.remote} wasn't cloned into it.`);
	const { error } = await checkoutIn(run, target, repo, repo.branch, folder, timeoutMs, names);
	return error ? refused(error) : null;
}
//#endregion
//#region src/handoff/main.ts
const ANSWER_MS = 2e4;
const ABANDONED_MS = 864e5;
const here = path.dirname(fileURLToPath(import.meta.url));
const modDir = path.join(here, "..");
const { dir: claudeDir, json: claudeJson } = claudePaths(process.env, os.homedir());
const isoplanDir = path.join(claudeDir, "isoplan");
const io = nodeIo();
const run = createRunGit();
const flag = (argv, name) => {
	const i = argv.indexOf(name);
	return i >= 0 && argv[i + 1] !== void 0 ? argv[i + 1] : null;
};
/** The session's own folder. */
const sessionDir = () => process.env.CLAUDE_PROJECT_DIR || process.cwd();
/** Where a prepare keeps the brief until it is sent. */
const outDir = (id) => path.join(claudeDir, "isoplan", "handoffs", "out", id);
async function tidyOut() {
	const root = path.join(claudeDir, "isoplan", "handoffs", "out");
	for (const name of await fs.readdir(root).catch(() => [])) {
		const dir = path.join(root, name);
		const st = await fs.stat(dir).catch(() => null);
		if (st?.isDirectory() && Date.now() - st.mtimeMs > ABANDONED_MS) await fs.rm(dir, {
			recursive: true,
			force: true
		}).catch(() => {});
	}
}
var Stop = class extends Error {};
const stop = (text) => {
	throw new Stop(text);
};
async function settings() {
	return loadSettings(io, path.join(modDir, "runner.json"), path.join(isoplanDir, "runner.json"));
}
/**
* The session's hello, as `project`: what the session reports as (data-layer/home.ts), or for a take,
* the project of the handoff's room. Nothing of a repo the office doesn't take is sent, its id
* included (#91).
*/
async function hello(cwd, project) {
	const id = process.env.CLAUDE_CODE_SESSION_ID;
	if (!id) stop("This runs inside a Claude Code session, which sets CLAUDE_CODE_SESSION_ID; it isn't set here.");
	return {
		type: "hello",
		v: 1,
		source: "claude-code",
		account: await accountOf({
			readText: (p) => fs.readFile(p, "utf8").catch(() => null),
			run: io.run
		}, claudeJson, cwd),
		machine: { name: os.hostname() },
		session: `claude-code:${id}`,
		project
	};
}
const loadOwnConfig = () => loadConfig(io, path.join(modDir, "config.json"), path.join(isoplanDir, "config.json"));
/** The offices config.json names that may be used, and the one `--office` picks (by label, address or host), if any; stops when it names none, or one that can't be used. */
async function officesNamed(argv) {
	const all = officesOf(await loadOwnConfig());
	const offices = all.filter((o) => !o.plainRefused);
	const name = flag(argv, "--office");
	const picked = name === null ? null : officeNamed(all, name) ?? stop(`"${name}" isn't one of the offices in config.json: ${all.map((o) => o.label).join(", ")}.`);
	if (picked?.plainRefused) stop(`${picked.server} is plain ws:// to another machine, so nothing is sent to it: use wss://, or set "allowPlainWs": true in config.json.`);
	if (!offices.length) stop(`${all.map((o) => o.server).join(", ")} ${all.length > 1 ? "are" : "is"} plain ws:// to another machine, so nothing is sent: use wss://, or set "allowPlainWs": true in config.json.`);
	return {
		offices,
		picked
	};
}
/**
* The office a hand-over from `cwd` goes to, what the session reports as there, by this machine's
* fresh copy of each office's list, and whether more than one office takes it; stops the command
* when no office takes it, or when more than one does and `--office` doesn't say which.
*/
async function officeHere(cwd, argv) {
	const config = await loadOwnConfig();
	const { offices, picked } = await officesNamed(argv);
	const taking = [];
	let refused = "";
	for (const office of offices) {
		const here = await commandHome(cwd, machineHomeIo(config.workspaceRepos, cachedRemoteNames(claudeDir)), {
			file: approvedPath(claudeDir, office.server),
			server: office.server,
			maxAgeMs: config.approvedMaxAgeMinutes * 6e4
		});
		if ("home" in here) taking.push({
			office,
			home: here.home
		});
		else refused ||= here.refused;
	}
	const chosen = handOverOffice(taking, picked, refused, (o) => o.label);
	return "refused" in chosen ? stop(chosen.refused) : chosen;
}
/** Which repos under `cwd` a handoff may take: the office's alone, by this machine's fresh copy of its list. */
async function takesHere(server) {
	const config = await loadOwnConfig();
	return takesFrom(machineHomeIo(config.workspaceRepos, cachedRemoteNames(claudeDir)), await cachedRepos(approvedPath(claudeDir, server), server, config.approvedMaxAgeMinutes * 6e4));
}
const TOKEN_LEFT_MS = 3e5;
/**
* This machine's pairing with `server` (#23), as a command uses it: only read. The
* kept token goes in the hello while it is current; otherwise the credential is swapped for one for
* this command alone (POST <server>/token), which isn't written back. Nothing here takes the
* pairing's locks, writes pairing.json or starts a pairing: the session's data layer does those,
* with its link in the status line. When a token can't be had, the command says the machine needs
* pairing.
*/
async function pairingWith(server) {
	const config = await loadOwnConfig();
	const file = pairingPath(claudeDir);
	const account = await accountOf({
		readText: (p) => fs.readFile(p, "utf8").catch(() => null),
		run: io.run
	}, claudeJson, os.homedir());
	return { async token(renew) {
		const entry = pairingEntry(await readPairing(file), server, account.id);
		if (!entry?.credential) return void 0;
		if (!config.allowPlainWs && isPlainRemote(server)) throw new PairingRefused(`${server} is plain ws:// to another machine, so this machine's pairing isn't sent over it: use wss://, or set "allowPlainWs": true in config.json.`);
		if (!renew && entry.token && (entry.tokenExpires ?? 0) - TOKEN_LEFT_MS > Date.now()) return entry.token;
		const answer = await postJson(httpUrl(server, "/token"), { credential: entry.credential }).catch(() => null);
		if (answer?.status === 200 && typeof answer.body.token === "string") return answer.body.token;
		throw new PairingRefused(NEEDS_PAIRING);
	} };
}
async function exchange(server, cwd, first, wanted, before, project) {
	const pairing = await pairingWith(server);
	try {
		return await openPairedLink(server, await hello(cwd, project), pairing, first, wanted, ANSWER_MS);
	} catch (err) {
		if (err instanceof PairingRefused) stop(`${before}${err.message}`);
		throw err;
	}
}
const said = (m) => `The office server says: ${m.message}`;
const CODE = /^[A-HJ-NP-Z2-9]{4}-?[A-HJ-NP-Z2-9]{4}$/i;
const NAME = /^[\p{L}\p{N}][\p{L}\p{N} ._@-]{0,79}$/u;
const nameOf = (argv) => {
	const to = (flag(argv, "--to") ?? "").trim();
	if (!NAME.test(to)) stop(`"${to}" isn't a name to hand over to: use their name or account id, in letters, digits, spaces and . _ @ - only, or "me" for a new session of yours.`);
	return to;
};
/** Whether the name is "me": a new session of the person's own. */
const toSelf = (to) => /^(me|myself)$/i.test(to);
async function prepareCommand(argv) {
	const to = nameOf(argv);
	const s = await settings();
	await tidyOut();
	const { office, several } = await officeHere(sessionDir(), argv);
	const prepared = await prepare(run, sessionDir(), s.gitTimeoutSeconds * 1e3, s.repoSearchDepth, void 0, await takesHere(office.server)).catch((err) => stop(err instanceof HandoffGitError ? `Can't hand over from here: ${gitFailed(err)}.` : String(err)));
	const id = newHandoffId();
	const folder = outDir(id);
	await fs.mkdir(folder, { recursive: true });
	const spinOff = argv.includes("--spin-off");
	const taskFile = path.join(folder, "task.md");
	const prompts = await loadPrompts(path.join(modDir, "prompts"));
	const values = {
		to: toSelf(to) ? "a new Claude Code session of this same person's" : to,
		untracked: untrackedLine(prepared.files)
	};
	const brief = spinOff ? fill(prompts.spinOff, {
		...values,
		task: `The task as written in ${taskFile}.`
	}) : fill(prompts.brief, values);
	const repos = prepared.repos.filter((r) => r.path !== ".").length ? [`Repos, by path in this folder: ${prepared.repos.map((r) => `${r.path} (${repoBranch(id, r)}${r.from ? `, from ${r.from}` : ""})`).join(", ")}`] : [];
	const left = prepared.left.length ? [`Left out: ${prepared.left.map((l) => `${l.path} (${l.why})`).join("; ")}`] : [];
	if (prepared.notInOffice.length) left.push(`Left out, not in the office (named here only, never sent): ${prepared.notInOffice.join(", ")}`);
	const offices = several ? [`Office: ${office.label} (pass --office "${office.label}" to hand-over)`] : [];
	const task = spinOff ? [`Task file: ${taskFile} (write the new task there first, as it was given)`] : [];
	return [
		`Handoff id: ${id}`,
		`Brief file: ${path.join(folder, "brief.md")}`,
		...task,
		...offices,
		`Branch: ${handoffBranch(id)}${prepared.from ? `, made from ${prepared.from}` : ""}`,
		...repos,
		...left,
		"",
		brief
	].join("\n");
}
function pushAnywayOf(argv) {
	const out = {};
	argv.forEach((arg, i) => {
		if (arg !== "--push-anyway") return;
		const value = argv[i + 1] ?? "";
		const at = value.lastIndexOf("=");
		const [repo, commit] = at >= 0 ? [value.slice(0, at), value.slice(at + 1)] : [".", value];
		if (!repo || !/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(commit)) stop("--push-anyway takes the held commit's full hash, with its repo's path and = before it for a repo under the folder, as hand-over printed it.");
		out[repo] = commit;
	});
	return out;
}
async function handOverCommand(argv) {
	const id = flag(argv, "--id") || stop("Missing --id: run prepare first.");
	if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) stop(`"${id}" isn't a handoff id.`);
	const to = nameOf(argv);
	const pushAnyway = pushAnywayOf(argv);
	const file = flag(argv, "--brief") || stop("Missing --brief <file>.");
	const written = (await fs.readFile(file, "utf8").catch(() => stop(`There is no brief at ${file}: write it there first.`))).trim();
	if (!written) stop(`The brief at ${file} is empty.`);
	if (argv.includes("--task") && flag(argv, "--task") === null) stop("hand-over --task needs the task file.");
	const preparedTask = path.join(outDir(id), "task.md");
	const taskPath = flag(argv, "--task") ?? await fs.access(preparedTask).then(() => preparedTask, () => null);
	const task = taskPath === null ? null : (await fs.readFile(taskPath, "utf8").catch(() => stop(`There is no task at ${taskPath}: write it there first.`))).trim();
	if (task === "") stop(`The task at ${taskPath} is empty.`);
	if (task && task.length > 4e3) stop(`The task at ${taskPath} is ${task.length} characters long; a task can be at most ${MAX_TASK_LENGTH}. Shorten it and run hand-over again.`);
	const cwd = sessionDir();
	const s = await settings();
	const timeoutMs = s.gitTimeoutSeconds * 1e3;
	const { office, home } = await officeHere(cwd, argv);
	const prepared = await prepare(run, cwd, timeoutMs, s.repoSearchDepth, void 0, await takesHere(office.server)).catch((err) => stop(err instanceof HandoffGitError ? `Can't hand over from here: ${gitFailed(err)}.` : String(err)));
	const { from, files, repos, left } = prepared;
	const unknown = Object.keys(pushAnyway).filter((repo) => !repos.some((r) => r.path === repo));
	if (unknown.length) stop(`--push-anyway names ${unknown.map((r) => r === "." ? "this folder's own repo" : r).join(", ")}, which this doesn't hand over (it hands over ${repos.map((r) => r.path).join(", ")}). Nothing was pushed.`);
	const brief = `${written}\n\n${handoffNote({
		branch: handoffBranch(id),
		from,
		files,
		at: /* @__PURE__ */ new Date(),
		repos,
		left
	})}`;
	const patterns = await loadPatterns(path.join(modDir, "secret-patterns.json"), path.join(isoplanDir, "secret-patterns.json"), () => {});
	const matched = scan(brief, patterns);
	if (matched) stop(`The brief wasn't sent: it matches the secret pattern "${matched}". Take that out of ${file} and run hand-over again.`);
	const taskMatched = task ? scan(task, patterns) : null;
	if (taskMatched) stop(`The task wasn't sent: it matches the secret pattern "${taskMatched}". Take that out of ${taskPath} and run hand-over again.`);
	const { link, answer: ready } = await exchange(office.server, cwd, {
		type: "hand-over-check",
		v: 1,
		to,
		handoff: id,
		...task ? { task } : {}
	}, (m) => m.type === "hand-over-ready" && m.handoff === id, "Nothing was pushed. ", home);
	try {
		if (ready.type === "error") stop(`Nothing was pushed. ${said(ready)}`);
		const pushed = await pushHandoff(run, cwd, id, timeoutMs, {
			scan: async (text) => scan(text, patterns),
			pushAnyway,
			prepared,
			names: cachedRemoteNames(claudeDir)
		}).catch((err) => stop(err instanceof HandoffGitError ? `The handoff wasn't sent: ${gitFailed(err)}.${err.pushed.length ? ` Run hand-over again with --id ${id} once that is fixed: it pushes the rest.` : ""}\n${err.detail}` : String(err)));
		if ("held" in pushed) {
			const unchecked = pushed.unchecked.length ? ` These files couldn't be checked (binary): ${pushed.unchecked.join(", ")}.` : "";
			const again = Object.entries(pushed.commits).map(([repo, commit]) => `--push-anyway ${repo === "." ? commit : `${repo}=${commit}`}`);
			const kept = Object.keys(pushAnyway).length ? ", keeping the --push-anyway you gave already" : "";
			stop(`Nothing was pushed: the lines the push would send to ${pushed.held.join(", ")} match a secret pattern.${unchecked} Take the secrets out, or, if they aren't any, run hand-over again with ${again.join(" ")}${kept}, to push those exact commits.`);
		}
		const { repos: sent } = pushed;
		const branch = handoffBranch(id);
		link.send({
			type: "hand-over",
			v: 1,
			to,
			handoff: {
				id,
				brief,
				repos: sent,
				...task ? { task } : {}
			}
		});
		const answer = await link.next((m) => m.type === "handed-over" && m.handoff === id, ANSWER_MS);
		const pushedBranches = sent.map((r) => r.path === "." ? r.branch : `${r.branch} in ${r.path}`).join(", ");
		if (answer.type === "error") stop(`${said(answer)}\nPushed: ${pushedBranches}. Run hand-over again with the same id once that is fixed.`);
		const name = answer.to.name || answer.to.id;
		if (path.resolve(path.dirname(file)) === path.resolve(outDir(id))) await fs.rm(outDir(id), {
			recursive: true,
			force: true
		}).catch(() => {});
		const inRepos = sent.some((r) => r.path !== ".") ? ` in ${sent.map((r) => r.branch === branch ? r.path : `${r.path} (as ${r.branch})`).join(", ")}` : "";
		const what = task ? "Spun off, with its new task," : "Handed over";
		const carryOn = task ? " This session carries on with its own work." : "";
		if (toSelf(to)) return `${what} to a new session of yours, on ${branch}${inRepos}. Open it from the floor with Take handoff, or copy its prompt there into a session you have.${carryOn}`;
		return `${what} to ${name}, on ${branch}${inRepos}. They will see a Take handoff button on the floor.${carryOn}`;
	} finally {
		await link.close();
	}
}
/**
* The project of the room `code` takes into (POST <server>/handoff-room), which the take says hello
* from: whatever folder the session is in, its own id isn't sent, and the session joins that room
* (#91); or what the office said when it doesn't know the code.
*/
async function roomOf(server, code, cwd) {
	const pairing = await pairingWith(server);
	let token;
	try {
		token = await pairing.token(false);
	} catch (err) {
		return { unknown: err instanceof PairingRefused ? err.message : String(err) };
	}
	const account = await accountOf({
		readText: (p) => fs.readFile(p, "utf8").catch(() => null),
		run: io.run
	}, claudeJson, cwd);
	const answer = await fetch(httpUrl(server, "/handoff-room"), {
		method: "POST",
		headers: {
			"content-type": "application/json",
			...token ? { authorization: `Bearer ${token}` } : {}
		},
		body: JSON.stringify({
			code,
			account: account.id
		}),
		signal: AbortSignal.timeout(ANSWER_MS)
	}).catch(() => null);
	if (!answer) return { unknown: `The office server at ${server} couldn't be reached.` };
	const body = await answer.json().catch(() => ({}));
	if (answer.status === 401) return { unknown: NEEDS_PAIRING };
	if (answer.status !== 200 || typeof body.project !== "string") return { unknown: `The office server says: ${typeof body.error === "string" ? body.error : `it answered ${answer.status}`}` };
	return { project: body.project };
}
async function takeCommand(argv) {
	const code = (argv[0] ?? "").trim();
	const { offices, picked } = await officesNamed(argv.slice(1));
	if (!CODE.test(code)) stop("That isn't a take code: it is the eight letters and digits the floor shows, like ABCD-EFGH.");
	const cwd = sessionDir();
	const timeoutMs = (await settings()).gitTimeoutSeconds * 1e3;
	const patterns = await loadPatterns(path.join(modDir, "secret-patterns.json"), path.join(isoplanDir, "secret-patterns.json"), () => {});
	const config = await loadOwnConfig();
	const room = await findRoom(offices, picked, code, {
		ask: (o, c) => roomOf(o.server, c, cwd),
		takes: async (o, project) => !!(await cachedRepos(approvedPath(claudeDir, o.server), o.server, config.approvedMaxAgeMinutes * 6e4))?.has(project.toLowerCase()),
		label: (o) => o.label
	});
	if ("refused" in room) stop(room.refused);
	const { office, project } = room;
	const { link, answer } = await exchange(office.server, cwd, {
		type: "take",
		v: 1,
		code
	}, (m) => m.type === "handoff", "", {
		id: project,
		name: project.split("/").pop() || project
	});
	try {
		if (answer.type === "error") stop(said(answer));
		const { handoff } = answer;
		const { failures, remote, dir } = await checkoutHere(run, cwd, handoff, handoffDir(claudeDir, handoff.id), timeoutMs, { names: cachedRemoteNames(claudeDir) });
		const sent = failures.map((f) => scan(f.output, patterns) ? {
			...f,
			output: "The end of its output is withheld here: it matches a secret pattern."
		} : f);
		link.send({
			type: "taken",
			v: 1,
			handoff: handoff.id,
			failures: sent
		});
		await recordTakenOffice(claudeDir, process.env.CLAUDE_CODE_SESSION_ID ?? "", office.server).catch(() => {});
		const branch = handoffBranch(handoff.id);
		const own = failures.find((f) => !f.repo);
		const done = handoff.repos.filter((r) => r.path !== "." && !failures.some((f) => f.repo === r.path));
		const checkout = own ? `The checkout of ${branch} failed, so this folder and the repos in it are as they were:\n${own.output}` : [
			handoff.repos.some((r) => r.path === ".") ? `The repo at ${dir} is now on ${branch}.` : "",
			done.length ? `These repos in ${dir} are now on their handoff branches: ${done.map((r) => `${r.path} (${r.branch})`).join(", ")}.` : "",
			...failures.map((f) => `The checkout of ${f.repo} failed, so that repo is as it was:\n${f.output}`)
		].filter(Boolean).join("\n");
		const setup = remote ? await setupCommand(run, {
			dir,
			remote
		}, process.platform, timeoutMs) : null;
		const setupNote = setup ? [`The repo's worktree setup script has NOT been run here: \`${setup}\` (from isoplan.json). Run it only if this folder isn't set up yet.`] : [];
		if (handoff.task) return [
			`You have taken Isoplan spin-off ${handoff.id}: a new task of your own, and this session is in its room now.`,
			checkout,
			...setupNote,
			"To ask the session it came from a question, use the Isoplan ask_room tool; it carries on with its own work.",
			"",
			"Your task:",
			"",
			handoff.task,
			"",
			"The brief, written for that task:",
			"",
			handoff.brief
		].join("\n");
		return [
			`You have taken Isoplan handoff ${handoff.id}, and this session is in its room now.`,
			checkout,
			...setupNote,
			"To ask the session it came from a question, use the Isoplan ask_room tool.",
			"",
			"The brief:",
			"",
			handoff.brief
		].join("\n");
	} finally {
		await link.close();
	}
}
async function main(argv) {
	const [command, ...rest] = argv;
	try {
		const out = command === "prepare" ? await prepareCommand(rest) : command === "hand-over" ? await handOverCommand(rest) : command === "take" ? await takeCommand(rest) : stop("usage: handoff.js prepare | hand-over | take");
		process.stdout.write(out + "\n");
		return 0;
	} catch (err) {
		process.stdout.write(`${err instanceof Stop ? err.message : `The handoff failed: ${err?.message ?? String(err)}`}\n`);
		return 1;
	}
}
process.exitCode = await main(process.argv.slice(2));
//#endregion
export {};
