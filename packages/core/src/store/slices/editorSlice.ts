import type { StateCreator } from 'zustand';

export type ActiveEntity =
  | { type: 'class'; className: string }
  | { type: 'slot'; className: string; slotName: string }
  | { type: 'enum'; enumName: string }
  | { type: 'edge'; edgeId: string }
  | { type: 'label'; labelId: string }
  | null;

export interface EditorSlice {
  // State
  activeEntity: ActiveEntity;
  /**
   * Set when the user navigates to a schema-level type from outside the
   * Properties Panel (e.g. clicking a type row in Outline View). SchemaMetaPanel
   * reads this to expand + scroll the matching SchemaTypeInlineEditor into view,
   * then clears it — types have no ActiveEntity variant since SchemaMetaPanel
   * (shown when activeEntity is null) already renders all of them inline.
   */
  scrollToSchemaTypeName: string | null;
  propertiesPanelOpen: boolean;
  displayPanelOpen: boolean;
  projectPanelOpen: boolean;
  gitPanelOpen: boolean;
  schemaSettingsOpen: boolean;
  validationPanelOpen: boolean;
  yamlPreviewOpen: boolean;
  cloneDialogOpen: boolean;
  importDialogOpen: boolean;
  newSchemaDialogOpen: boolean;
  switchProjectDialogOpen: boolean;
  openFromUrlDialogOpen: boolean;
  commandPaletteOpen: boolean;

  // Actions
  setActiveEntity(entity: ActiveEntity): void;
  clearActiveEntity(): void;
  setScrollToSchemaTypeName(name: string | null): void;
  setPropertiesPanelOpen(open: boolean): void;
  setDisplayPanelOpen(open: boolean): void;
  setProjectPanelOpen(open: boolean): void;
  setGitPanelOpen(open: boolean): void;
  setSchemaSettingsOpen(open: boolean): void;
  setValidationPanelOpen(open: boolean): void;
  setYamlPreviewOpen(open: boolean): void;
  setCloneDialogOpen(open: boolean): void;
  setImportDialogOpen(open: boolean): void;
  setNewSchemaDialogOpen(open: boolean): void;
  setSwitchProjectDialogOpen(open: boolean): void;
  setOpenFromUrlDialogOpen(open: boolean): void;
  setCommandPaletteOpen(open: boolean): void;
}

export const createEditorSlice: StateCreator<EditorSlice, [], [], EditorSlice> = (set) => ({
  activeEntity: null,
  scrollToSchemaTypeName: null,
  propertiesPanelOpen: true,
  displayPanelOpen: true,
  projectPanelOpen: true,
  gitPanelOpen: false,
  schemaSettingsOpen: false,
  validationPanelOpen: false,
  yamlPreviewOpen: true,
  cloneDialogOpen: false,
  importDialogOpen: false,
  newSchemaDialogOpen: false,
  switchProjectDialogOpen: false,
  openFromUrlDialogOpen: false,
  commandPaletteOpen: false,

  setActiveEntity(entity) {
    set({ activeEntity: entity });
  },

  clearActiveEntity() {
    set({ activeEntity: null });
  },

  setScrollToSchemaTypeName(name) {
    set({ scrollToSchemaTypeName: name });
  },

  setPropertiesPanelOpen(open) {
    set({ propertiesPanelOpen: open });
  },

  setDisplayPanelOpen(open) {
    set({ displayPanelOpen: open });
  },

  setProjectPanelOpen(open) {
    set({ projectPanelOpen: open });
  },

  setGitPanelOpen(open) {
    set({ gitPanelOpen: open });
  },

  setSchemaSettingsOpen(open) {
    set({ schemaSettingsOpen: open });
  },

  setValidationPanelOpen(open) {
    set({ validationPanelOpen: open });
  },

  setYamlPreviewOpen(open) {
    set({ yamlPreviewOpen: open });
  },

  setCloneDialogOpen(open) {
    set({ cloneDialogOpen: open });
  },

  setImportDialogOpen(open) {
    set({ importDialogOpen: open });
  },

  setNewSchemaDialogOpen(open) {
    set({ newSchemaDialogOpen: open });
  },

  setSwitchProjectDialogOpen(open) {
    set({ switchProjectDialogOpen: open });
  },

  setOpenFromUrlDialogOpen(open) {
    set({ openFromUrlDialogOpen: open });
  },

  setCommandPaletteOpen(open) {
    set({ commandPaletteOpen: open });
  },
});
