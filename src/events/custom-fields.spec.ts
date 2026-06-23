import { describe, expect, it } from '@jest/globals';
import { CustomFieldDefinitionDto } from './dto/custom-field-definition.dto';
import { parseFieldDefinitions, validateCustomData } from './custom-fields';

const def = (
  over: Partial<CustomFieldDefinitionDto>,
): CustomFieldDefinitionDto => ({
  id: 'f1',
  label: 'Field',
  type: 'text',
  required: false,
  ...over,
});

describe('parseFieldDefinitions', () => {
  it('returns [] for null / non-array', () => {
    expect(parseFieldDefinitions(null)).toEqual([]);
    expect(parseFieldDefinitions({ not: 'array' } as any)).toEqual([]);
  });

  it('passes an array through', () => {
    const fields = [def({})];
    expect(parseFieldDefinitions(fields as any)).toEqual(fields);
  });
});

describe('validateCustomData', () => {
  it('flags a missing required field', () => {
    const errors = validateCustomData([def({ id: 'f1', required: true })], {});
    expect(errors).toHaveLength(1);
  });

  it('skips an absent optional field', () => {
    expect(validateCustomData([def({ id: 'f1' })], {})).toEqual([]);
  });

  it('rejects a select value outside its options', () => {
    const errors = validateCustomData(
      [def({ id: 'size', type: 'select', options: ['S', 'M', 'L'] })],
      { size: 'XL' },
    );
    expect(errors).toHaveLength(1);
  });

  it('accepts a valid select value', () => {
    expect(
      validateCustomData(
        [def({ id: 'size', type: 'select', options: ['S', 'M'] })],
        { size: 'M' },
      ),
    ).toEqual([]);
  });

  it('rejects checkbox selections outside options', () => {
    const errors = validateCustomData(
      [def({ id: 'diet', type: 'checkbox', options: ['vegan', 'halal'] })],
      { diet: ['vegan', 'other'] },
    );
    expect(errors).toHaveLength(1);
  });

  it('accepts a valid checkbox subset', () => {
    expect(
      validateCustomData(
        [def({ id: 'diet', type: 'checkbox', options: ['vegan', 'halal'] })],
        { diet: ['vegan'] },
      ),
    ).toEqual([]);
  });
});
