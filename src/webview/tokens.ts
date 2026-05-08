// Single source of truth for all layout constants and spacing.
// Every view imports from here — no hardcoded pixel values anywhere.

export const TOKENS = {
  // Horizontal padding
  rowPx: 18,
  sectionPx: 20,
  // Vertical padding
  toolbarPy: 10,
  contentPy: 16,
  // Border radii
  radius: { sm: 4, md: 6, lg: 10 },
  // Font sizes (px)
  fs: { xs: 10.5, sm: 11, md: 12, base: 13, body: 13.5, lg: 15 },
  // Shared column grid for all list views (checkbox | mark | name | pr | arrows | action)
  listGridCols: '16px 14px minmax(0,1fr) 80px 70px 36px',
} as const;
