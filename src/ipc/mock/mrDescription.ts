import type { MrDescription } from '../types/MrDescription';
import type { MrDescriptionVariant } from '../types/MrDescriptionVariant';

/** CreateMR.dc.html's title. */
export const MR_TITLE = 'Enable compiled bindings in app pages';

/** CreateMR.dc.html's D1: the first Write and the longer version. */
export const MR_DESCRIPTION_LONG =
  '## What\nAdds x:DataType to 12 pages and their DataTemplates, so XAML bindings are compiled.\n\n## Why\nCompiled bindings fail at build time instead of silently at runtime, and they are faster. Two broken bindings showed up and are fixed here: DeliveryListPage (Adress → Address) and ScannerPage.\n\n## How to test\n1. Build Release for Android and iOS.\n2. Open Deliveries, Scanner and Account. Lists and labels show data.\n3. Rotate the device on Deliveries. Nothing goes blank.';

/** CreateMR.dc.html's D2: the shorter version. */
export const MR_DESCRIPTION_SHORT =
  '## What\nTurns on compiled bindings (x:DataType) in all 12 app pages.\n\n## Why\nTypos in bindings now break the build. This MR already fixes the two it found.\n\n## How to test\n1. Release build on a device.\n2. Click through Deliveries, Scanner, Account.\n3. Rotate on Deliveries.';

/** CreateMR.dc.html's regenerate lasts 1.1 s, so "Writing…" is visible. */
export const MOCK_MR_DESCRIPTION_MS = 1100;

/** What the mock's Claude writes for a variant (F-27.2). */
export function mockMrDescription(variant: MrDescriptionVariant): MrDescription {
  return {
    title: MR_TITLE,
    description: variant === 'short' ? MR_DESCRIPTION_SHORT : MR_DESCRIPTION_LONG,
  };
}
