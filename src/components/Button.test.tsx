import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from './Button';
import { Kbd } from './Kbd';

describe('Button', () => {
  it('is a plain button by default, so it never submits a form', () => {
    render(<Button>Browse files</Button>);
    expect(screen.getByRole('button', { name: 'Browse files' })).toHaveAttribute('type', 'button');
  });

  it('keeps the label in sentence case in the DOM (uppercase comes from CSS)', () => {
    render(<Button variant="primary">Start</Button>);
    expect(screen.getByRole('button')).toHaveTextContent('Start');
  });

  it('activates with click, Enter and Space', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button variant="approve" onClick={onClick}>
        Approve MR
      </Button>,
    );
    await user.click(screen.getByRole('button'));
    await user.tab();
    await user.tab({ shift: true });
    expect(screen.getByRole('button')).toHaveFocus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onClick).toHaveBeenCalledTimes(3);
  });

  it('does nothing when disabled', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button variant="send" disabled onClick={onClick}>
        Publish
      </Button>,
    );
    await user.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('puts a key hint on a filled button in its on-color style', () => {
    const { container } = render(
      <>
        <Button variant="primary">
          Start <Kbd>↵</Kbd>
        </Button>
        <Button variant="neutral">
          Next <Kbd>]</Kbd>
        </Button>
      </>,
    );
    const [onColor, plain] = Array.from(container.querySelectorAll('kbd'));
    expect(onColor?.className).not.toBe(plain?.className);
  });
});
