import { z } from "zod";
import type {
  $ZodIssueTooBig,
  $ZodIssueTooSmall,
  $ZodIssueInvalidType,
  $ZodIssueInvalidStringFormat,
} from "zod/v4/core";
import type { ValidationErrorDetail } from "@o11yfleet/core/api";
import { ApiError, parseJsonBody } from "./errors.js";

export class ValidationError extends ApiError {
  constructor(message: string, field?: string, detail?: ValidationErrorDetail) {
    super(message, 400, "validation_error", field, detail);
    this.name = "ValidationError";
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

export async function validateJsonBody<Schema extends z.ZodTypeAny>(
  request: Request,
  schema: Schema,
): Promise<z.output<Schema>> {
  const body = await parseJsonBody<unknown>(request);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw validationErrorFromZod(parsed.error);
  }
  return parsed.data;
}

function validationErrorFromZod(error: z.ZodError): ValidationError {
  const issue = error.issues[0];
  if (!issue) {
    return new ValidationError("Invalid request body", "body", "invalid_value");
  }
  const field = fieldForIssue(issue);
  const detail = detailForIssue(issue);
  return new ValidationError(messageForIssue(issue, field, detail), field, detail);
}

function fieldForIssue(issue: z.ZodIssue): string {
  if (issue.code === z.ZodIssueCode.unrecognized_keys && issue.keys[0]) {
    return [...issue.path.map(String), issue.keys[0]].join(".");
  }
  if (
    issue.code === z.ZodIssueCode.invalid_union &&
    typeof issue.path[issue.path.length - 1] === "number"
  ) {
    return issue.path.slice(0, -1).map(String).join(".") || "body";
  }
  if (issue.path.length > 0) {
    return issue.path.map(String).join(".");
  }
  return "body";
}

function messageForIssue(issue: z.ZodIssue, field: string, detail: ValidationErrorDetail): string {
  if (field !== "body") {
    if (detail === "required" || detail === "too_short") return `${field} is required`;
    if (detail === "expected_string") return `${field} must be a string`;
    if (detail === "expected_number") return `${field} must be a number`;
    if (detail === "expected_boolean") return `${field} must be a boolean`;
    if (detail === "expected_array") return `${field} must be an array`;
    if (detail === "expected_object") return `${field} must be an object`;
    if (detail === "unknown_field") return `Unknown field: ${field}`;
  }
  return issue.message;
}

function detailForIssue(issue: z.ZodIssue): ValidationErrorDetail {
  switch (issue.code) {
    case z.ZodIssueCode.unrecognized_keys:
      return "unknown_field";
    case z.ZodIssueCode.invalid_value:
      return "invalid_enum";
    case z.ZodIssueCode.invalid_format:
      return (issue as $ZodIssueInvalidStringFormat).format === "url"
        ? "invalid_url"
        : "invalid_value";
    case z.ZodIssueCode.too_big:
      return detailForTooBig(issue as $ZodIssueTooBig);
    case z.ZodIssueCode.too_small:
      return detailForTooSmall(issue as $ZodIssueTooSmall);
    case z.ZodIssueCode.invalid_type:
      return detailForInvalidType(issue as $ZodIssueInvalidType);
    case z.ZodIssueCode.invalid_union:
      return "invalid_item";
    case z.ZodIssueCode.custom:
      return "custom";
    default:
      return "invalid_value";
  }
}

function detailForTooBig(issue: $ZodIssueTooBig): ValidationErrorDetail {
  if (issue.origin === "string") return "too_long";
  if (issue.origin === "array") return "too_many_items";
  if (issue.origin === "number" || issue.origin === "int" || issue.origin === "bigint")
    return "too_large";
  return "too_large";
}

function detailForTooSmall(issue: $ZodIssueTooSmall): ValidationErrorDetail {
  if (issue.origin === "string") return "too_short";
  if (issue.origin === "array") return "too_few_items";
  if (issue.origin === "number" || issue.origin === "int" || issue.origin === "bigint")
    return "expected_positive_int";
  return "too_short";
}

function detailForInvalidType(issue: $ZodIssueInvalidType): ValidationErrorDetail {
  if (issue.input === undefined) return "required";
  switch (issue.expected) {
    case "array":
      return "expected_array";
    case "boolean":
      return "expected_boolean";
    case "number":
      return "expected_number";
    case "object":
      return "expected_object";
    case "string":
      return "expected_string";
    default:
      return "invalid_type";
  }
}
