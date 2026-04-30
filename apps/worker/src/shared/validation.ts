import { ApiError, parseJsonBody } from "./errors.js";

type FieldBase = {
  required?: boolean;
};

type StringField = FieldBase & {
  type: "string";
  maxLength?: number;
  trim?: boolean;
  minLength?: number;
};

type EnumField = FieldBase & {
  type: "enum";
  values: readonly string[];
};

type PositiveIntField = FieldBase & {
  type: "positiveInt";
  max?: number;
};

type UrlField = FieldBase & {
  type: "url";
  protocols?: readonly string[];
  maxLength?: number;
};

type ArrayField = FieldBase & {
  type: "array";
  maxLength?: number;
  validateItem?: (value: unknown) => boolean;
  itemDetail?: string;
};

export type FieldSpec = StringField | EnumField | PositiveIntField | UrlField | ArrayField;
export type ObjectSchema = Record<string, FieldSpec>;

export class ValidationError extends ApiError {
  constructor(message: string, field?: string, detail?: string) {
    super(message, 400, "validation_error", field, detail);
    this.name = "ValidationError";
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

export async function validateJsonBody<T>(request: Request, schema: ObjectSchema): Promise<T> {
  const body = await parseJsonBody<unknown>(request);
  if (!isPlainObject(body)) {
    throw new ValidationError("Request body must be a JSON object", "body", "expected_object");
  }

  for (const field of Object.keys(body)) {
    if (!(field in schema)) {
      throw new ValidationError(`Unknown field: ${field}`, field, "unknown_field");
    }
  }

  const output: Record<string, unknown> = {};
  for (const [field, spec] of Object.entries(schema)) {
    const value = body[field];
    if (value === undefined) {
      if (spec.required) {
        throw new ValidationError(`${field} is required`, field, "required");
      }
      continue;
    }
    output[field] = validateField(field, value, spec);
  }
  return output as T;
}

function validateField(field: string, value: unknown, spec: FieldSpec): unknown {
  switch (spec.type) {
    case "string":
      return validateString(field, value, spec);
    case "enum":
      return validateEnum(field, value, spec);
    case "positiveInt":
      return validatePositiveInt(field, value, spec);
    case "url":
      return validateUrl(field, value, spec);
    case "array":
      return validateArray(field, value, spec);
  }
}

function validateString(field: string, value: unknown, spec: StringField): string {
  if (typeof value !== "string") {
    throw new ValidationError(`${field} must be a string`, field, "expected_string");
  }
  const normalized = spec.trim ? value.trim() : value;
  if (spec.minLength !== undefined && normalized.length < spec.minLength) {
    throw new ValidationError(`${field} is required`, field, "too_short");
  }
  if (spec.maxLength !== undefined && normalized.length > spec.maxLength) {
    throw new ValidationError(
      `${field} must be ${spec.maxLength} characters or fewer`,
      field,
      "too_long",
    );
  }
  return normalized;
}

function validateEnum(field: string, value: unknown, spec: EnumField): string {
  if (typeof value !== "string" || !spec.values.includes(value)) {
    throw new ValidationError(
      `${field} must be one of: ${spec.values.join(", ")}`,
      field,
      "invalid_enum",
    );
  }
  return value;
}

function validatePositiveInt(field: string, value: unknown, spec: PositiveIntField): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new ValidationError(
      `${field} must be a positive integer`,
      field,
      "expected_positive_int",
    );
  }
  if (spec.max !== undefined && value > spec.max) {
    throw new ValidationError(`${field} must be ${spec.max} or less`, field, "too_large");
  }
  return value;
}

function validateUrl(field: string, value: unknown, spec: UrlField): string {
  const url = validateString(field, value, {
    type: "string",
    maxLength: spec.maxLength,
    trim: true,
    minLength: 1,
  });
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ValidationError(`${field} must be a valid URL`, field, "invalid_url");
  }
  const protocols = spec.protocols ?? ["http:", "https:"];
  if (!protocols.includes(parsed.protocol)) {
    throw new ValidationError(`${field} must use http or https`, field, "invalid_url_protocol");
  }
  return url;
}

function validateArray(field: string, value: unknown, spec: ArrayField): unknown[] {
  if (!Array.isArray(value)) {
    throw new ValidationError(`${field} must be an array`, field, "expected_array");
  }
  if (spec.maxLength !== undefined && value.length > spec.maxLength) {
    throw new ValidationError(
      `${field} must contain ${spec.maxLength} items or fewer`,
      field,
      "too_many_items",
    );
  }
  if (spec.validateItem) {
    for (const item of value) {
      if (!spec.validateItem(item)) {
        throw new ValidationError(
          `${field} contains an invalid value`,
          field,
          spec.itemDetail ?? "invalid_item",
        );
      }
    }
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
