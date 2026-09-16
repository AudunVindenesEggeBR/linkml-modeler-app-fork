import { useEffect, useRef, useState } from 'react';
import type { TypeDefinition } from '../../model/index.js';
import { FieldRow, TextInput, TextArea, FilteredGroupedSelect } from '../../ui/fields/index.js';
import type { OptionGroup } from '../../ui/fields/index.js';
import { DeleteButton } from './internal.js';
import { styles } from './styles.js';

export function SchemaTypeInlineEditor({
  type,
  schemaTypes,
  typeOptionGroups,
  scrollTarget,
  onScrolled,
  onUpdate,
  onDelete,
  onRename,
}: {
  type: TypeDefinition;
  schemaTypes: Record<string, TypeDefinition>;
  typeOptionGroups: OptionGroup[];
  /** True when this row was just navigated to (e.g. from Outline View) and should expand + scroll into view. */
  scrollTarget?: boolean;
  onScrolled?: () => void;
  onUpdate: (partial: Partial<TypeDefinition>) => void;
  onDelete: () => void;
  onRename: (newName: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);

  // Syncing an external navigation trigger (Outline View click) into local
  // expand state + an imperative scroll — same deliberate one-shot-sync
  // shape/precedent as OutlineView's auto-focus-on-mount effect.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (scrollTarget) {
      setExpanded(true);
      rowRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      onScrolled?.();
    }
  }, [scrollTarget, onScrolled]);
  /* eslint-enable react-hooks/set-state-in-effect */

  return (
    <div ref={rowRef} style={styles.slotEditor}>
      <button type="button" style={styles.slotEditorHeader} onClick={() => setExpanded((v) => !v)}>
        <span style={styles.slotEditorToggle}>{expanded ? '▾' : '▸'}</span>
        <span style={styles.slotEditorName}>{type.name}</span>
        {type.typeof && <span style={styles.slotEditorRange}>: {type.typeof}</span>}
      </button>

      {expanded && (
        <div style={styles.slotEditorBody}>
          <FieldRow label="Name">
            <TextInput
              value={type.name}
              onChange={() => {}}
              onCommit={(v) => {
                const newName = v.trim();
                if (newName && newName !== type.name && !schemaTypes[newName]) onRename(newName);
              }}
              monospace
            />
          </FieldRow>
          <FieldRow label="Description">
            <TextArea
              value={type.description ?? ''}
              onChange={(v) => onUpdate({ description: v || undefined })}
              placeholder="Optional…"
            />
          </FieldRow>
          <FieldRow label="typeof">
            <FilteredGroupedSelect
              value={type.typeof ?? ''}
              onChange={(v) => onUpdate({ typeof: v || undefined })}
              groups={typeOptionGroups}
              placeholder="(none)"
            />
          </FieldRow>
          <FieldRow label="base">
            <TextInput
              value={type.base ?? ''}
              onChange={(v) => onUpdate({ base: v || undefined })}
              placeholder="e.g. str, int"
              monospace
            />
          </FieldRow>
          <FieldRow label="uri">
            <TextInput
              value={type.uri ?? ''}
              onChange={(v) => onUpdate({ uri: v || undefined })}
              placeholder="e.g. xsd:string"
              monospace
            />
          </FieldRow>
          <div style={styles.slotEditorActions}>
            <DeleteButton label="type" onConfirm={onDelete} />
          </div>
        </div>
      )}
    </div>
  );
}
