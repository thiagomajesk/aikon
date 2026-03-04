export function resolveToolbarExpandedLayout(
  _activeTab: string | null,
  isHistoryExpanded: boolean,
): boolean {
  return isHistoryExpanded;
}

export function resolveToolbarGridTemplateRows(isToolbarExpanded: boolean): string {
  if (isToolbarExpanded) {
    return "minmax(0, 0fr) minmax(0, 1fr)";
  }

  return "minmax(0, 1fr) auto";
}
