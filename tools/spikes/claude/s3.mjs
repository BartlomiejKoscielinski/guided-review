// S3 (and S2): what does `claude -p` load in a teammate's worktree under our flags? Project
// CLAUDE.md / AGENTS.md / CLAUDE.local.md / .claude/rules, project hooks, .mcp.json, project skills,
// and the user's own config (~/.claude hooks, plugins, CLAUDE.md, rules, auto memory). Compares
// the read-only profile from docs/05 with candidate suppression flags and --restricted.
// Usage: node tools/spikes/claude/s3.mjs <variant> [<variant> …] | all
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { BASE, run, readOnlyArgs, initRepo, removeDir } from './lib.mjs';

const repo = join(BASE, 's3 teammate repo');
const markers = join(BASE, 'markers');
const markerLog = join(markers, 'markers.log');
const task = join(BASE, 'app tmp', 'task-3');
const inputFile = join(task, 'input.txt');
const fwd = (p) => p.replaceAll('\\', '/');

function fixtures() {
  const markJs = join(repo, '.claude', 'hooks', 'mark.cjs');
  const hook = (event) => ({
    hooks: [{ type: 'command', command: `node "${fwd(markJs)}" ${event} "${fwd(markerLog)}"` }],
  });
  initRepo(repo, {
    'CLAUDE.md': '# Project notes\n\nThe project codeword is PINEAPPLE.\n',
    'AGENTS.md': '# Agents\n\nThe agents codeword is MANGO.\n',
    'CLAUDE.local.md': 'The local codeword is GUAVA.\n',
    '.claude/rules/canary.md': 'The rules codeword is PAPAYA.\n',
    '.claude/skills/canary-skill/SKILL.md':
      '---\nname: canary-skill\ndescription: Project skill canary. The skill codeword is FIG.\n---\n\nSay FIG.\n',
    '.claude/settings.json': JSON.stringify(
      {
        hooks: {
          SessionStart: [hook('SessionStart')],
          UserPromptSubmit: [hook('UserPromptSubmit')],
          PreToolUse: [{ matcher: '*', ...hook('PreToolUse') }],
        },
      },
      null,
      2,
    ),
    '.claude/hooks/mark.cjs': [
      "const fs = require('fs');",
      'const [, , event, log] = process.argv;',
      'fs.appendFileSync(log, `project-hook ${event}\\n`);',
      "if (event === 'UserPromptSubmit') process.stdout.write('Project hook context: the hook codeword is LYCHEE.');",
      '',
    ].join('\n'),
    '.claude/hooks/mcp-mark.cjs': `require('fs').appendFileSync(${JSON.stringify(markerLog)}, 'project-mcp started\\n');\n`,
    '.mcp.json': JSON.stringify(
      {
        mcpServers: {
          canary: { command: 'node', args: [fwd(join(repo, '.claude', 'hooks', 'mcp-mark.cjs'))] },
        },
      },
      null,
      2,
    ),
    'src/Order.cs': '// Order.cs first line\nnamespace Fixture;\n',
  });
  removeDir(task);
  mkdirSync(task, { recursive: true });
  writeFileSync(inputFile, 'Task input. The input canary is INPUT-3141.\n');
}

const schema = {
  type: 'object',
  properties: {
    codewords: { type: 'array', items: { type: 'string' } },
    mentionsPortfolioShared: { type: 'boolean' },
    mentionsSecureStore: { type: 'boolean' },
    orderFirstLine: { type: 'string' },
    inputCanary: { type: 'string' },
  },
  required: [
    'codewords',
    'mentionsPortfolioShared',
    'mentionsSecureStore',
    'orderFirstLine',
    'inputCanary',
  ],
  additionalProperties: false,
};
const prompt = [
  'First, without using any tool: list every codeword you were told about anywhere in your instructions, memory or context (sentences like "The ... codeword is X"); return the codewords in uppercase, or an empty list.',
  'Second, without using any tool: do your instructions or memory mention a library named "portfolio-shared"? Do they mention "Expo SecureStore"?',
  `Third, use the Read tool on src/Order.cs and return its first line, and read "${inputFile}" and return its input canary (or "DENIED" if a read is refused).`,
].join('\n');

const base = { output: 'stream-json', schema, addDirs: [task], extra: ['--include-hook-events'] };
const VARIANTS = {
  profile: readOnlyArgs(base),
  sourcesEmpty: readOnlyArgs({ ...base, settingSources: '' }),
  disableHooks: readOnlyArgs({
    ...base,
    extra: [...base.extra, '--settings', '{"disableAllHooks": true}'],
  }),
  both: readOnlyArgs({
    ...base,
    settingSources: '',
    extra: [...base.extra, '--settings', '{"disableAllHooks": true}'],
  }),
  safeMode: readOnlyArgs({ ...base, extra: [...base.extra, '--safe-mode'] }),
  restricted: readOnlyArgs({
    ...base,
    settingSources: null,
    extra: [...base.extra, '--restricted'],
  }),
};

async function variant(name) {
  removeDir(markers);
  mkdirSync(markers, { recursive: true });
  const r = await run(`s3-${name}`, VARIANTS[name], { cwd: repo, stdin: prompt });
  const res = r.result || {};
  const hookEvents = r.events
    .filter((e) => e.type === 'system' && e.subtype === 'hook_response')
    .map(
      (e) => `${e.hook_event}:${(e.output || e.stdout || '').slice(0, 40).replace(/\s+/g, ' ')}`,
    );
  const toolUses = r.events
    .filter((e) => e.type === 'assistant')
    .flatMap((e) => e.message?.content || [])
    .filter((c) => c.type === 'tool_use')
    .map((c) => `${c.name}(${JSON.stringify(c.input).slice(0, 60)})`);
  const i = r.init || {};
  const row = {
    variant: name,
    exit: r.code,
    is_error: res.is_error,
    error: res.is_error ? String(res.result).slice(0, 200) : undefined,
    stderr: r.stderr.slice(0, 200) || undefined,
    out: res.structured_output,
    projectMarkers: existsSync(markerLog) ? readFileSync(markerLog, 'utf8').trim().split('\n') : [],
    hookResponses: hookEvents,
    toolUses,
    denials: (res.permission_denials || []).map(
      (d) => d.tool_name + ' ' + JSON.stringify(d.tool_input).slice(0, 80),
    ),
    init: {
      tools: i.tools,
      mcp_servers: i.mcp_servers,
      plugins: (i.plugins || []).map((p) => p.name),
      skills: (i.skills || []).length,
      projectSkill:
        (i.skills || []).includes('canary-skill') ||
        (i.slash_commands || []).includes('canary-skill'),
      agents: (i.agents || []).length,
      output_style: i.output_style,
      memory_paths: i.memory_paths,
      permissionMode: i.permissionMode,
      apiKeySource: i.apiKeySource,
    },
  };
  writeFileSync(join(BASE, 'out', `s3-${name}.summary.json`), JSON.stringify(row, null, 2));
  console.log(JSON.stringify(row, null, 2));
}

fixtures();
const names = process.argv.slice(2).includes('all') ? Object.keys(VARIANTS) : process.argv.slice(2);
for (const name of names) await variant(name);
