import { Prisma } from '@prisma/client';
import { CustomFieldDefinitionDto } from './dto/custom-field-definition.dto';

export type CustomFieldResponses = Record<string, unknown>;

/** Coerce an event's `customFields` JSON column into field definitions (or none). */
export function parseFieldDefinitions(
  customFields: Prisma.JsonValue | null | undefined,
): CustomFieldDefinitionDto[] {
  return Array.isArray(customFields)
    ? (customFields as unknown as CustomFieldDefinitionDto[])
    : [];
}

function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '';
}

/**
 * Validate attendee `customData` against an event's field definitions. Returns a
 * (possibly empty) list of human-readable errors. Covers presence of required fields
 * and option membership for select/radio/checkbox; advanced rules (regex, length,
 * selection counts) are deferred.
 */
export function validateCustomData(
  definitions: CustomFieldDefinitionDto[],
  responses: CustomFieldResponses = {},
): string[] {
  const errors: string[] = [];

  for (const def of definitions) {
    const value = responses[def.id];

    if (!isPresent(value)) {
      if (def.required) errors.push(`${def.label} is required`);
      continue;
    }

    switch (def.type) {
      case 'select':
      case 'radio':
        if (
          typeof value !== 'string' ||
          (def.options && !def.options.includes(value))
        ) {
          errors.push(
            `${def.label} must be one of: ${(def.options ?? []).join(', ')}`,
          );
        }
        break;
      case 'checkbox':
        if (
          def.options &&
          (!Array.isArray(value) ||
            value.some(
              (v) => typeof v !== 'string' || !def.options!.includes(v),
            ))
        ) {
          errors.push(`${def.label} has invalid selections`);
        }
        break;
      case 'text':
      case 'textarea':
        if (typeof value !== 'string') {
          errors.push(`${def.label} must be text`);
        }
        break;
    }
  }

  return errors;
}
