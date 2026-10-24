import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderApp } from '../../test/renderApp';

// F-27.4 on S-11 (route {screen:'S-11'}). Decisions of the tests stage: the options are the
// Checkbox component (role="checkbox", accessible name = the visible text, aria-checked) inside
// the region "Options" (CreateMR.dc.html draws them as role="switch" buttons, but the plan row
// and the spec say checkboxes); the region sits in the main column after the Description, in the
// order Mark as draft, Delete branch after merge, Squash commits. The Create button is in the
// aside "Reviewers and checks": "Create merge request", and "Create draft MR" while Mark as draft
// is on (its click is F-27.6 and is not tested here). Choosing another target keeps the options.

const DRAFT = 'Mark as draft';
const DELETE = 'Delete branch after merge';
const SQUASH = 'Squash commits';

function show() {
  renderApp({ screen: 'S-11' });
}

const options = async () => within(await screen.findByRole('region', { name: 'Options' }));
const create = () => screen.getByRole('button', { name: /^Create (merge request|draft MR)$/ });

describe('S-11 options (F-27.4)', () => {
  it('F-27.4 offers Mark as draft, Delete branch after merge and Squash commits as checkboxes in that order', async () => {
    show();
    const region = await options();
    expect(region.getAllByRole('checkbox').map((c) => c.getAttribute('aria-label'))).toEqual([
      DRAFT,
      DELETE,
      SQUASH,
    ]);
    expect(region.getByText(DRAFT)).toBeVisible();
    expect(region.getByText(DELETE)).toBeVisible();
    expect(region.getByText(SQUASH)).toBeVisible();
  });

  it('F-27.4 the options sit after the Description in the main column', async () => {
    show();
    const description = await screen.findByRole('textbox', { name: 'Description' });
    const region = await screen.findByRole('region', { name: 'Options' });
    expect(
      description.compareDocumentPosition(region) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('F-27.4 starts with Delete branch after merge on, Mark as draft and Squash commits off', async () => {
    show();
    const region = await options();
    expect(region.getByRole('checkbox', { name: DRAFT })).toHaveAttribute('aria-checked', 'false');
    expect(region.getByRole('checkbox', { name: DELETE })).toHaveAttribute('aria-checked', 'true');
    expect(region.getByRole('checkbox', { name: SQUASH })).toHaveAttribute('aria-checked', 'false');
  });

  it('F-27.4 each click toggles only its own option', async () => {
    const user = userEvent.setup();
    show();
    const region = await options();
    await user.click(region.getByRole('checkbox', { name: SQUASH }));
    expect(region.getByRole('checkbox', { name: SQUASH })).toHaveAttribute('aria-checked', 'true');
    expect(region.getByRole('checkbox', { name: DRAFT })).toHaveAttribute('aria-checked', 'false');
    expect(region.getByRole('checkbox', { name: DELETE })).toHaveAttribute('aria-checked', 'true');
    await user.click(region.getByRole('checkbox', { name: DELETE }));
    expect(region.getByRole('checkbox', { name: DELETE })).toHaveAttribute('aria-checked', 'false');
    expect(region.getByRole('checkbox', { name: SQUASH })).toHaveAttribute('aria-checked', 'true');
    await user.click(region.getByRole('checkbox', { name: SQUASH }));
    expect(region.getByRole('checkbox', { name: SQUASH })).toHaveAttribute('aria-checked', 'false');
  });

  it('F-27.4 the options are toggled from the keyboard with Space', async () => {
    const user = userEvent.setup();
    show();
    const region = await options();
    region.getByRole('checkbox', { name: DRAFT }).focus();
    await user.keyboard(' ');
    expect(region.getByRole('checkbox', { name: DRAFT })).toHaveAttribute('aria-checked', 'true');
  });

  it('F-27.4 the button reads Create merge request, and Create draft MR while Mark as draft is on', async () => {
    const user = userEvent.setup();
    show();
    const region = await options();
    expect(create()).toHaveTextContent('Create merge request');
    expect(screen.queryByRole('button', { name: 'Create draft MR' })).toBeNull();
    await user.click(region.getByRole('checkbox', { name: DRAFT }));
    expect(screen.getByRole('button', { name: 'Create draft MR' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create merge request' })).toBeNull();
    await user.click(region.getByRole('checkbox', { name: DRAFT }));
    expect(screen.getByRole('button', { name: 'Create merge request' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create draft MR' })).toBeNull();
  });

  it('F-27.4 the button is in the aside, and only Mark as draft changes its label', async () => {
    const user = userEvent.setup();
    show();
    const region = await options();
    const aside = screen.getByRole('complementary', { name: 'Reviewers and checks' });
    expect(within(aside).getByRole('button', { name: 'Create merge request' })).toBe(create());
    await user.click(region.getByRole('checkbox', { name: SQUASH }));
    await user.click(region.getByRole('checkbox', { name: DELETE }));
    expect(within(aside).getByRole('button', { name: 'Create merge request' })).toBe(create());
    await user.click(region.getByRole('checkbox', { name: DRAFT }));
    expect(within(aside).getByRole('button', { name: 'Create draft MR' })).toBe(create());
  });

  it('F-27.4 choosing another target keeps the options and the draft label', async () => {
    const user = userEvent.setup();
    show();
    const region = await options();
    await user.click(region.getByRole('checkbox', { name: DRAFT }));
    await user.click(region.getByRole('checkbox', { name: SQUASH }));
    await user.click(region.getByRole('checkbox', { name: DELETE }));
    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'Target branch' }),
      'main',
    );
    const after = await options();
    expect(after.getByRole('checkbox', { name: DRAFT })).toHaveAttribute('aria-checked', 'true');
    expect(after.getByRole('checkbox', { name: SQUASH })).toHaveAttribute('aria-checked', 'true');
    expect(after.getByRole('checkbox', { name: DELETE })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('button', { name: 'Create draft MR' })).toBeInTheDocument();
  });
});
