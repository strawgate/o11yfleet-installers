/**
 * Pipeline-builder validation result type.
 *
 * The hook itself was removed in the dead-code sweep — the builder state is
 * managed inline in PipelineBuilderPage now. The validation shape is still
 * imported by ValidationStrip.
 */

export interface BuilderValidation {
  ok: boolean;
  canSave: boolean;
  errors: Array<{ code: string; message: string; component_id?: string }>;
  warnings: Array<{ code: string; message: string; component_id?: string }>;
}
