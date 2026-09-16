import { useMemo } from 'react';
import { useAppStore } from '../../../store/index.js';
import type { OptionGroup } from '../../../ui/fields/index.js';

/**
 * Returns grouped built-in + schema-defined type options, for a
 * TypeDefinition's `typeof` (parent type) field. Deliberately excludes
 * classes/enums — unlike a slot's `range`, a type's parent must itself be a
 * type. See useRangeOptionGroups for the (separate) range-field equivalent
 * that does include classes/enums.
 */
export function useTypeOptionGroups(excludeTypeName?: string): OptionGroup[] {
  const allSchemas = useAppStore((s) => s.activeProject?.schemas ?? []);

  return useMemo(() => {
    const builtinTypes = ['string', 'integer', 'float', 'boolean', 'date', 'datetime', 'uri', 'uriorcurie'];
    const groups: OptionGroup[] = [
      { label: 'Built-in types', options: builtinTypes },
    ];

    for (const sf of allSchemas) {
      const label = sf.filePath.replace(/\.ya?ml$/, '');
      const typeNames = Object.keys(sf.schema.types ?? {})
        .filter((n) => n !== excludeTypeName)
        .sort();
      if (typeNames.length > 0) {
        groups.push({ label, options: typeNames });
      }
    }

    return groups;
  }, [allSchemas, excludeTypeName]);
}
