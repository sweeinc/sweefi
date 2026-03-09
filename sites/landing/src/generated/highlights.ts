// Pre-rendered syntax highlighting using Tokyo Night theme colors.
// Zero runtime JS cost — pure HTML strings.

// Tokyo Night palette:
// keyword: #bb9af7 | string: #9ece6a | comment: #565f89
// function: #7aa2f7 | variable: #c0caf5 | type: #2ac3de
// punctuation: #89ddff | constant: #ff9e64 | text: #a9b1d6

const k = 'color:#bb9af7'  // keyword
const s = 'color:#9ece6a'  // string
const c = 'color:#565f89'  // comment
const f = 'color:#7aa2f7'  // function
const v = 'color:#c0caf5'  // variable
const t = 'color:#2ac3de'  // type
const p = 'color:#89ddff'  // punctuation/operator
const x = 'color:#a9b1d6'  // default text

function line(...parts: string[]): string {
  return parts.join('') + '\n'
}
function sp(style: string, text: string): string {
  return `<span style="${style}">${esc(text)}</span>`
}
function esc(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ── Hero Code ──
export const heroHtml = [
  line(sp(k, 'import'), sp(x, ' { '), sp(v, 'createS402Client'), sp(x, ' } '), sp(k, 'from'), sp(x, ' '), sp(s, "'@sweefi/sui'"), sp(p, ';')),
  line(),
  line(sp(k, 'const'), sp(x, ' '), sp(v, 'client'), sp(x, ' '), sp(p, '='), sp(x, ' '), sp(f, 'createS402Client'), sp(x, '({ '), sp(v, 'wallet'), sp(p, ':'), sp(x, ' '), sp(v, 'myKeypair'), sp(p, ','), sp(x, ' '), sp(v, 'network'), sp(p, ':'), sp(x, ' '), sp(s, "'sui:testnet'"), sp(x, ' }'), sp(p, ';')),
  line(sp(k, 'const'), sp(x, ' '), sp(v, 'data'), sp(x, ' '), sp(p, '='), sp(x, ' '), sp(k, 'await'), sp(x, ' '), sp(v, 'client'), sp(p, '.'), sp(f, 'fetch'), sp(x, '('), sp(s, "'https://api.example.com/premium-data'"), sp(x, ')'), sp(p, ';')),
  line(sp(c, '// 402 -> auto-signs SUI payment -> retries -> returns data')),
].join('')

// ── Tab 1: AI Agent ──
export const agentHtml = [
  line(sp(k, 'import'), sp(x, ' { '), sp(v, 'createS402Client'), sp(x, ' } '), sp(k, 'from'), sp(x, ' '), sp(s, "'@sweefi/sui'"), sp(p, ';')),
  line(sp(k, 'import'), sp(x, ' { '), sp(t, 'Ed25519Keypair'), sp(x, ' } '), sp(k, 'from'), sp(x, ' '), sp(s, "'@mysten/sui/keypairs/ed25519'"), sp(p, ';')),
  line(),
  line(sp(k, 'const'), sp(x, ' '), sp(v, 'wallet'), sp(x, ' '), sp(p, '='), sp(x, ' '), sp(t, 'Ed25519Keypair'), sp(p, '.'), sp(f, 'fromSecretKey'), sp(x, '('), sp(v, 'myKey'), sp(x, ')'), sp(p, ';')),
  line(sp(k, 'const'), sp(x, ' '), sp(v, 'client'), sp(x, ' '), sp(p, '='), sp(x, ' '), sp(f, 'createS402Client'), sp(x, '({ '), sp(v, 'wallet'), sp(p, ','), sp(x, ' '), sp(v, 'network'), sp(p, ':'), sp(x, ' '), sp(s, "'sui:testnet'"), sp(x, ' }'), sp(p, ';')),
  line(),
  line(sp(c, '// Any fetch to a 402-gated endpoint auto-pays')),
  line(sp(k, 'const'), sp(x, ' '), sp(v, 'data'), sp(x, ' '), sp(p, '='), sp(x, ' '), sp(k, 'await'), sp(x, ' '), sp(v, 'client'), sp(p, '.'), sp(f, 'fetch'), sp(x, '('), sp(s, "'https://api.example.com/premium'"), sp(x, ')'), sp(p, ';')),
].join('')

// ── Tab 2: API Provider ──
export const serverHtml = [
  line(sp(k, 'import'), sp(x, ' { '), sp(t, 'Hono'), sp(x, ' } '), sp(k, 'from'), sp(x, ' '), sp(s, "'hono'"), sp(p, ';')),
  line(sp(k, 'import'), sp(x, ' { '), sp(v, 's402Gate'), sp(x, ' } '), sp(k, 'from'), sp(x, ' '), sp(s, "'@sweefi/server'"), sp(p, ';')),
  line(),
  line(sp(k, 'const'), sp(x, ' '), sp(v, 'app'), sp(x, ' '), sp(p, '='), sp(x, ' '), sp(k, 'new'), sp(x, ' '), sp(t, 'Hono'), sp(x, '()'), sp(p, ';')),
  line(),
  line(sp(v, 'app'), sp(p, '.'), sp(f, 'use'), sp(x, '('), sp(s, "'/premium'"), sp(p, ','), sp(x, ' '), sp(f, 's402Gate'), sp(x, '({')),
  line(sp(x, '  '), sp(v, 'price'), sp(p, ':'), sp(x, ' '), sp(s, "'1000000'"), sp(p, ','), sp(x, '        '), sp(c, '// 0.001 SUI')),
  line(sp(x, '  '), sp(v, 'network'), sp(p, ':'), sp(x, ' '), sp(s, "'sui:testnet'"), sp(p, ',')),
  line(sp(x, '  '), sp(v, 'payTo'), sp(p, ':'), sp(x, ' '), sp(s, "'0xYOUR_ADDRESS'"), sp(p, ',')),
  line(sp(x, '  '), sp(v, 'schemes'), sp(p, ':'), sp(x, ' ['), sp(s, "'exact'"), sp(x, ']'), sp(p, ',')),
  line(sp(x, '}))'), sp(p, ';')),
  line(),
  line(sp(v, 'app'), sp(p, '.'), sp(f, 'get'), sp(x, '('), sp(s, "'/premium'"), sp(p, ','), sp(x, ' ('), sp(v, 'c'), sp(x, ') '), sp(p, '=>'), sp(x, ' '), sp(v, 'c'), sp(p, '.'), sp(f, 'json'), sp(x, '({ '), sp(v, 'data'), sp(p, ':'), sp(x, ' '), sp(s, "'premium content'"), sp(x, ' }))'), sp(p, ';')),
].join('')

// ── Tab 3: MCP (Claude) ──
export const mcpHtml = [
  line(sp(x, '{')),
  line(sp(x, '  '), sp(v, '"mcpServers"'), sp(p, ':'), sp(x, ' {')),
  line(sp(x, '    '), sp(v, '"sweefi"'), sp(p, ':'), sp(x, ' {')),
  line(sp(x, '      '), sp(v, '"command"'), sp(p, ':'), sp(x, ' '), sp(s, '"npx"'), sp(p, ',')),
  line(sp(x, '      '), sp(v, '"args"'), sp(p, ':'), sp(x, ' ['), sp(s, '"@sweefi/mcp"'), sp(x, ']'), sp(p, ',')),
  line(sp(x, '      '), sp(v, '"env"'), sp(p, ':'), sp(x, ' {')),
  line(sp(x, '        '), sp(v, '"SUI_NETWORK"'), sp(p, ':'), sp(x, ' '), sp(s, '"testnet"'), sp(p, ',')),
  line(sp(x, '        '), sp(v, '"SUI_PRIVATE_KEY"'), sp(p, ':'), sp(x, ' '), sp(s, '"<your-base64-key>"')),
  line(sp(x, '      }')),
  line(sp(x, '    }')),
  line(sp(x, '  }')),
  line(sp(x, '}')),
].join('')

// ── Tab 4: CLI ──
export const cliHtml = [
  line(sp(c, '# Install')),
  line(sp(v, 'npm'), sp(x, ' install -g '), sp(s, '@sweefi/cli')),
  line(),
  line(sp(c, '# Create a wallet')),
  line(sp(v, 'sweefi'), sp(x, ' wallet create')),
  line(),
  line(sp(c, '# Pay for a 402-gated endpoint')),
  line(sp(v, 'sweefi'), sp(x, ' pay '), sp(s, 'https://api.example.com/forecast')),
  line(),
  line(sp(c, '# Check prepaid balance')),
  line(sp(v, 'sweefi'), sp(x, ' prepaid status '), sp(p, '<'), sp(x, 'balance-id'), sp(p, '>')),
].join('')

// Plain text versions for clipboard copy
export const heroPlain = `import { createS402Client } from '@sweefi/sui';

const client = createS402Client({ wallet: myKeypair, network: 'sui:testnet' });
const data = await client.fetch('https://api.example.com/premium-data');
// 402 -> auto-signs SUI payment -> retries -> returns data`

export const agentPlain = `import { createS402Client } from '@sweefi/sui';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';

const wallet = Ed25519Keypair.fromSecretKey(myKey);
const client = createS402Client({ wallet, network: 'sui:testnet' });

// Any fetch to a 402-gated endpoint auto-pays
const data = await client.fetch('https://api.example.com/premium');`

export const serverPlain = `import { Hono } from 'hono';
import { s402Gate } from '@sweefi/server';

const app = new Hono();

app.use('/premium', s402Gate({
  price: '1000000',        // 0.001 SUI
  network: 'sui:testnet',
  payTo: '0xYOUR_ADDRESS',
  schemes: ['exact'],
}));

app.get('/premium', (c) => c.json({ data: 'premium content' }));`

export const mcpPlain = `{
  "mcpServers": {
    "sweefi": {
      "command": "npx",
      "args": ["@sweefi/mcp"],
      "env": {
        "SUI_NETWORK": "testnet",
        "SUI_PRIVATE_KEY": "<your-base64-key>"
      }
    }
  }
}`

export const cliPlain = `# Install
npm install -g @sweefi/cli

# Create a wallet
sweefi wallet create

# Pay for a 402-gated endpoint
sweefi pay https://api.example.com/forecast

# Check prepaid balance
sweefi prepaid status <balance-id>`
