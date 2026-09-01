#!/usr/bin/env node
// Quem o agente de DM atende, quem ele ignora.
//
//   node contatos.mjs                              # o placar + quem esta bloqueado
//   node contatos.mjs listar                       # todos, com o estado de cada um
//   node contatos.mjs listar bru                   # so quem tem "bru" no @
//   node contatos.mjs bloquear @fulano @beltrano   # o bot NUNCA atende
//   node contatos.mjs liberar  @fulano             # volta a atender
//   node contatos.mjs quem @fulano                 # a ficha de um contato
//
// Bloquear e para amigo, familia, quem pediu pra nao receber. E diferente de pausar:
// pausa vence (o <SEU NOME> respondeu -> volta em 24h); bloqueio nao vence nunca.
//
// Node puro, sem dependencia: fala com o Supabase por PostgREST, como o resto do kit.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const ENV = path.resolve(AQUI, '../.env.local');

function env(chave) {
  const linha = fs.readFileSync(ENV, 'utf8').split('\n').find((l) => l.startsWith(chave + '='));
  if (!linha) throw new Error(`${chave} nao encontrado em ${ENV}`);
  return linha.slice(chave.length + 1).trim();
}
const URL_BASE = env('SUPABASE_URL') + '/rest/v1/ig_contato_dm';
const CHAVE = env('SUPABASE_SERVICE_ROLE_KEY');
const H = { apikey: CHAVE, Authorization: `Bearer ${CHAVE}`, 'Content-Type': 'application/json' };

async function ler(query) {
  const r = await fetch(`${URL_BASE}?${query}`, { headers: H });
  if (!r.ok) throw new Error(`leitura falhou (${r.status}): ${(await r.text()).slice(0, 200)}`);
  return r.json();
}
async function escrever(query, campos) {
  const r = await fetch(`${URL_BASE}?${query}`, {
    method: 'PATCH', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify(campos) });
  if (!r.ok) throw new Error(`escrita falhou (${r.status}): ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

const arroba = (s) => String(s).replace(/^@/, '').toLowerCase();
const hora = (d) => new Date(d).toLocaleString('pt-BR',
  { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

function estado(c) {
  if (c.bloqueado) return '🔇 bloqueado';
  if (c.pausa_ativa) return c.pausado_ate ? `⏸️  pausado ate ${hora(c.pausado_ate)}` : '⏸️  pausa eterna';
  return '🟢 atende';
}

// aceita @usuario ou o proprio sender_id
async function achar(alvo) {
  const u = arroba(alvo);
  const r = await ler(`or=(username.ilike.${encodeURIComponent(u)},sender_id.eq.${encodeURIComponent(alvo)})`);
  return r;
}

const [, , cmd = 'placar', ...args] = process.argv;

try {
  if (cmd === 'placar') {
    const todos = await ler('select=bloqueado,pausa_ativa,quente,classificacao&limit=5000');
    const n = (f) => todos.filter(f).length;
    console.log(`\n  ${todos.length} contatos no total`);
    console.log(`  🟢 ${n((c) => !c.bloqueado && !c.pausa_ativa)} o bot atende`);
    console.log(`  ⏸️  ${n((c) => c.pausa_ativa && !c.bloqueado)} pausados (pre-carga ou o <SEU NOME> assumiu)`);
    console.log(`  🔇 ${n((c) => c.bloqueado)} bloqueados (nunca atende)`);
    console.log(`  🔥 ${n((c) => c.quente)} marcados como quentes\n`);
    const b = await ler('bloqueado=is.true&select=username,sender_id,notas&order=username');
    if (b.length) {
      console.log('  Bloqueados:');
      b.forEach((x) => console.log(`    @${String(x.username || x.sender_id).padEnd(26)} ${x.notas || ''}`));
      console.log('');
    }
  }

  else if (cmd === 'listar') {
    const filtro = args[0] ? arroba(args[0]) : null;
    const r = await ler(filtro
      ? `username=ilike.*${encodeURIComponent(filtro)}*&order=username&limit=5000`
      : 'order=bloqueado.desc,username&limit=5000');
    if (!r.length) console.log(`\n  nenhum contato com "${filtro}" no @\n`);
    else {
      console.log(`\n  ${r.length} contato(s)${filtro ? ` com "${filtro}"` : ''}:\n`);
      r.forEach((x) => console.log(
        `  ${estado(x).padEnd(30)} @${String(x.username || '(sem @)').padEnd(26)} ${String(x.classificacao || '').padEnd(11)} ${x.sender_id}`));
      console.log('');
    }
  }

  else if (cmd === 'bloquear' || cmd === 'liberar') {
    if (!args.length) { console.log(`\n  uso: node contatos.mjs ${cmd} @fulano [@beltrano ...]\n`); process.exit(1); }
    const bloquear = cmd === 'bloquear';
    console.log('');
    for (const alvo of args) {
      const achou = await achar(alvo);
      if (!achou.length) { console.log(`  ❓ ${alvo} — nao esta na tabela (nunca te mandou DM?)`); continue; }
      if (achou.length > 1) {
        console.log(`  ⚠️  ${alvo} casou com ${achou.length}: ${achou.map((r) => '@' + r.username).join(', ')} — use o sender_id`);
        continue;
      }
      const c = achou[0];
      const campos = bloquear
        ? { bloqueado: true, classificacao: 'pessoal', notas: `bloqueado em ${hora(Date.now())}`, atualizado_em: new Date().toISOString() }
        : { bloqueado: false, notas: null, atualizado_em: new Date().toISOString() };
      await escrever(`sender_id=eq.${encodeURIComponent(c.sender_id)}`, campos);
      console.log(`  ${bloquear ? '🔇' : '🟢'} @${c.username || c.sender_id} ${bloquear ? 'bloqueado — o bot nunca atende' : 'liberado'}`);
    }
    console.log('');
  }

  else if (cmd === 'quem') {
    const achou = await achar(args[0] || '');
    if (!achou.length) { console.log(`\n  nao achei "${args[0]}"\n`); process.exit(1); }
    const x = achou[0];
    console.log(`\n  @${x.username || '(sem @)'}   ${estado(x)}`);
    console.log(`  id             ${x.sender_id}`);
    console.log(`  origem         ${x.origem}`);
    console.log(`  classificacao  ${x.classificacao || '—'}${x.quente ? '   🔥 quente' : ''}`);
    console.log(`  mensagens      ${x.qtd_mensagens}`);
    console.log(`  viu o menu     ${x.menu_enviado_em ? 'sim, em ' + hora(x.menu_enviado_em) : 'nao'}`);
    console.log(`  ultima escolha ${x.ultima_escolha || '—'}`);
    if (x.primeira_mensagem) console.log(`  1a mensagem    "${x.primeira_mensagem}"`);
    if (x.notas) console.log(`  notas          ${x.notas}`);
    console.log('');
  }

  else console.log('\n  comandos: placar | listar [trecho] | bloquear @a @b | liberar @a | quem @a\n');
} catch (e) {
  console.error('\n  ✗', e.message, '\n');
  process.exit(1);
}
