import type { BlockColor } from '../../components/colors';
import type { DetectedSource } from '../../ipc/types/DetectedSource';

export interface DetectedLabel {
  text: string;
  /** The color of the column the source belongs to: MRs blue, commits white, own changes green. */
  color: BlockColor;
}

/** The block next to the input (F-01.2): "Merge request !482", "Commit a3f9c12", … */
export function detectedLabel(source: DetectedSource): DetectedLabel {
  switch (source.kind) {
    case 'mr':
      return { text: `Merge request !${String(source.iid)}`, color: 'blue' };
    case 'commit':
      return { text: `Commit ${source.shortSha}`, color: 'white' };
    case 'branch':
      return { text: `Branch ${source.name}`, color: 'green' };
    case 'repository':
      return { text: `Repository ${source.name}`, color: 'green' };
  }
}
