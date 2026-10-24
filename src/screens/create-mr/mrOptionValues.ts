export interface MrOptionValues {
  draft: boolean;
  deleteBranch: boolean;
  squash: boolean;
}

/** F-27.4 defaults: Delete branch after merge on, the other two off (CreateMR.dc.html). */
export const DEFAULT_MR_OPTIONS: MrOptionValues = {
  draft: false,
  deleteBranch: true,
  squash: false,
};
