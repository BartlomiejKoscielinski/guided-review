import type { Finding } from '../../types/Finding';
import type { StepAnalysis } from '../../types/StepAnalysis';

/** The step of !482 the design mocks show: "Step 4 / 8", the ViewModel's SendPhoto. */
export const NOTES_STEP = 's4';

const VM = 'src/Mobile.App/ViewModels/DeliveryPhotoViewModel.cs';

const note = (
  id: string,
  severity: Finding['severity'],
  kind: string,
  line: number,
  title: string,
  body: string,
  evidence: Finding['evidence'][number],
  suggestedComment: string,
): Finding => ({
  id,
  stepId: NOTES_STEP,
  severity,
  kind,
  title,
  body,
  file: VM,
  side: 'new',
  line,
  evidence: [evidence],
  suggestedComment,
  fingerprint: `${id}00000000000000`.slice(0, 16),
  decision: 'open',
});

/** Main.dc.html's notes f1–f4. */
export const FINDINGS: Finding[] = [
  note(
    'f1',
    'q',
    'photo-in-database',
    46,
    'The whole photo goes into SQLite as byte[]',
    'PendingUpload holds the photo bytes and SqliteUploadQueue from step 2 stores them as a BLOB. A camera photo is usually several MB, so during a long offline period the database grows fast.',
    { file: 'src/Mobile.Core/Uploads/PendingUpload.cs', line: 5, note: 'byte[] Photo' },
    'Did we consider saving the file in FileSystem.AppDataDirectory and keeping only the path in the queue?',
  ),
  note(
    'f2',
    'fix',
    'stale-state',
    49,
    'PendingCount won’t refresh after upload',
    'The counter is only computed when adding. UploadWorker from step 3 removes items from the queue but never notifies the ViewModel, so the offline banner will show a stale number.',
    {
      file: 'src/Mobile.Infrastructure/Uploads/UploadWorker.cs',
      line: 58,
      note: 'removes the item',
    },
    'Could IUploadQueue publish changes (an event or WeakReferenceMessenger) so the ViewModel refreshes PendingCount after each upload?',
  ),
  note(
    'f3',
    'nit',
    'hardcoded-text',
    51,
    'Status texts are hardcoded',
    'The rest of the view uses AppResources. Keys for these texts already exist in Strings.resx (marked as a mechanical change).',
    { file: 'src/Mobile.App/Resources/Strings/AppResources.resx', line: 1, note: 'the keys' },
    'Nit: take StatusText from AppResources, the keys are already in Strings.resx.',
  ),
  note(
    'f4',
    'fix',
    'swallowed-cancel',
    54,
    'catch (Exception) also catches camera cancellation',
    'When the user closes the camera, CaptureAsync throws OperationCanceledException. Right now that ends with a save error message even though nothing broke.',
    { file: 'src/Mobile.App/Services/CameraService.cs', line: 31, note: 'CaptureAsync' },
    'Consider a separate catch (OperationCanceledException) without a message. Closing the camera isn’t a save error.',
  ),
];

/** The analysis of `NOTES_STEP`; other steps have nothing that stood out. */
export function stepAnalysis(stepId: string): StepAnalysis {
  if (stepId !== NOTES_STEP) {
    return { stepId, findings: [], checklist: [], filesRead: [], folds: [] };
  }
  return {
    stepId,
    findings: FINDINGS,
    checklist: [
      'Matches the MR description: the photo is saved even without network',
      'The “Saved offline…” message is agreed with PO or UX',
      'On a device: a double tap doesn’t add two entries',
    ],
    filesRead: [
      { file: 'src/Mobile.Core/Uploads/IUploadQueue.cs', why: 'The queue contract.' },
      { file: 'src/Mobile.Infrastructure/Uploads/UploadWorker.cs', why: 'Who empties the queue.' },
      { file: 'src/Mobile.App/Services/CameraService.cs', why: 'What CaptureAsync throws.' },
      { file: 'src/Mobile.App/Resources/Strings/AppResources.resx', why: 'Existing text keys.' },
    ],
    folds: [
      {
        file: VM,
        newStart: 12,
        newEnd: 31,
        title: 'Fields and constructor',
        reason: '3 new dependencies',
      },
    ],
  };
}

/** The streamed mock answer, in the pieces it arrives in. */
export const ANSWER_PARTS = [
  'SendPhoto no longer calls the API. ',
  'It wraps the photo in a PendingUpload, ',
  'stores it in the queue from step 1 ',
  'and wakes UploadWorker, which sends it once the network is back. ',
  'The banner shows the status instead of a dialog.',
];
