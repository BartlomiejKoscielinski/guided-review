import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MOCK_ORDERS, mockPlan } from '../../ipc/mock/fixtures/plan';
import type { Plan } from '../../ipc/types/Plan';
import { PlanAside } from './PlanAside';

const position = (order: string[]) => (id: string) => order.indexOf(id) + 1;

function renderAside(plan: Plan = mockPlan(), order = MOCK_ORDERS.contractToUi) {
  render(<PlanAside plan={plan} position={position(order)} />);
  return screen.getByRole('complementary', { name: 'Plan details' });
}

const section = (name: string) =>
  screen.getByRole('heading', { name }).closest('section') as HTMLElement;

describe('S-02 PlanAside', () => {
  it('F-06.7 risks with severity and step numbers in the reader order', () => {
    renderAside();
    const risks = within(section('Risks to check')).getAllByRole('listitem');
    expect(risks).toHaveLength(3);
    expect(risks[0]).toHaveTextContent(
      'Should fix: Photos stored as BLOBs in SQLite: database size during a long offline period. Steps 2, 4',
    );
    expect(risks[2]).toHaveTextContent('Question: Worker starts in App:');
    expect(within(risks[2] as HTMLElement).getByText('App').tagName).toBe('CODE');
    expect(risks[2]).toHaveTextContent('Step 6');
  });

  it('F-06.7 step numbers follow the order (Tests first)', () => {
    renderAside(mockPlan(), MOCK_ORDERS.testsFirst);
    expect(within(section('Risks to check')).getAllByRole('listitem')[1]).toHaveTextContent(
      'Step 4',
    );
  });

  it('F-06.13 the app risk comes first', () => {
    const plan = mockPlan();
    plan.risks.push({
      text: 'This MR changes review or Claude configuration: CLAUDE.md',
      severity: 'fix',
      steps: [],
      app: true,
    });
    renderAside(plan);
    expect(within(section('Risks to check')).getAllByRole('listitem')[0]).toHaveTextContent(
      'This MR changes review or Claude configuration: CLAUDE.md',
    );
  });

  it('F-06.8 description claims: found in step N, or what the description leaves out', () => {
    const plan = mockPlan();
    plan.descriptionCheck.push({ claim: 'Offline mode for signatures', status: 'missing' });
    renderAside(plan);
    const claims = within(section('MR description vs code')).getAllByRole('listitem');
    expect(claims[0]).toHaveTextContent('“Retries with backoff” · found in step 3');
    expect(claims[1]).toHaveTextContent('“Banner with the pending count” · found in step 5');
    expect(claims[2]).toHaveTextContent(
      "The description doesn't mention the new AndroidManifest permission · step 7",
    );
    expect(claims[2]).toHaveTextContent('!');
    expect(claims[3]).toHaveTextContent('“Offline mode for signatures” · not found in the code');
  });

  it('F-06.9 already discussed shows the summary', () => {
    renderAside();
    expect(section('Already discussed')).toHaveTextContent(
      '2 open threads from Paweł S. in step 2.',
    );
  });

  it('F-06.10 coverage: N/N files · N/N hunks with the rule text', () => {
    renderAside();
    const coverage = section('Coverage');
    expect(coverage).toHaveTextContent('16/16 files · 31/31 hunks');
    expect(coverage).toHaveTextContent(
      "The plan can change the order but can't skip anything. If Claude misses a hunk, the app adds it to an “Other” step.",
    );
  });

  it('F-06.7 F-06.8 empty sections are left out', () => {
    const plan = { ...mockPlan(), risks: [], descriptionCheck: [], alreadyDiscussed: '' };
    renderAside(plan);
    expect(screen.queryByRole('heading', { name: 'Risks to check' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'MR description vs code' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Already discussed' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Coverage' })).toBeInTheDocument();
  });
});
