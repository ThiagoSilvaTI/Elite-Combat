const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;

// ================== BANCO DE DADOS ==================
const DB_DIR = path.join(__dirname, 'database');
const CONTRATOS_DIR = path.join(DB_DIR, 'contratos');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
if (!fs.existsSync(CONTRATOS_DIR)) fs.mkdirSync(CONTRATOS_DIR, { recursive: true });

const db = new Database(path.join(DB_DIR, 'elite_combat.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS inscricoes (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    numero_cadastro TEXT UNIQUE NOT NULL,
    data_preenchimento TEXT NOT NULL,
    responsavel_atendimento TEXT NOT NULL,
    nome          TEXT NOT NULL,
    data_nascimento TEXT NOT NULL,
    idade         INTEGER NOT NULL,
    telefone      TEXT NOT NULL,
    turma         TEXT NOT NULL,
    periodo       TEXT,
    horario       TEXT,
    ja_muaythai   TEXT,
    ja_outra_arte TEXT,
    modalidade    TEXT,
    tempo_pratica TEXT,
    objetivo      TEXT,
    resp_nome     TEXT,
    resp_parentesco TEXT,
    resp_telefone TEXT,
    emerg_nome    TEXT NOT NULL,
    emerg_parentesco TEXT,
    emerg_telefone TEXT NOT NULL,
    saude_json    TEXT,
    adaptacoes    TEXT,
    autorizou_dados TEXT,
    contrato_path TEXT,
    criado_em     TEXT DEFAULT (datetime('now'))
  );
`);

// ================== DETECÇÃO DE DISPOSITIVO ==================
/**
 * Detecta se a requisição vem de um dispositivo móvel.
 * Prioriza: 1) Escolha manual (cookie), 2) User-Agent, 3) Client Hints
 */
function ehDispositivoMovel(req) {
  // 1) Respeita escolha manual do usuário (cookie)
  if (req.cookies && req.cookies.preferencia_versao) {
    return req.cookies.preferencia_versao === 'mobile';
  }

  const ua = (req.headers['user-agent'] || '').toLowerCase();

  // 2) Client Hints (Chrome/Edge modernos) — mais confiável
  const chMobile = req.headers['sec-ch-ua-mobile'];
  if (chMobile === '?1') return true;
  if (chMobile === '?0') return false;

  // 3) User-Agent clássico
  const padroesMobile = [
    /android/i,
    /webos/i,
    /iphone/i,
    /ipad/i,
    /ipod/i,
    /blackberry/i,
    /windows phone/i,
    /opera mini/i,
    /iemobile/i,
    /mobile/i,
  ];

  // iPads modernos se passam por desktop — detecta via touch
  const isIPad = /macintosh/i.test(ua) && /mobile/i.test(ua);

  return isIPad || padroesMobile.some((p) => p.test(ua));
}

// Middleware para ler cookies sem dependência externa
app.use((req, res, next) => {
  req.cookies = {};
  const raw = req.headers.cookie;
  if (raw) {
    raw.split(';').forEach((pair) => {
      const [k, ...v] = pair.split('=');
      if (k) req.cookies[k.trim()] = decodeURIComponent(v.join('=').trim());
    });
  }
  next();
});

// ================== APP ==================
app.use(express.json({ limit: '1mb' }));

// Redireciona para versão correta
app.get('/', (req, res) => {
  if (ehDispositivoMovel(req)) {
    return res.redirect('/mobile/');
  }
  return res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Servir arquivos estáticos
app.use(express.static(path.join(__dirname, 'public')));

// ================== API: PREFERÊNCIA MANUAL ==================
/**
 * Permite o usuário forçar a versão (desktop ou mobile).
 * Ex.: /api/preferencia?versao=desktop
 */
app.get('/api/preferencia', (req, res) => {
  const { versao } = req.query;
  if (versao !== 'desktop' && versao !== 'mobile') {
    return res.status(400).send('Versão inválida.');
  }

  // Cookie válido por 1 ano
  res.setHeader(
    'Set-Cookie',
    `preferencia_versao=${versao}; Path=/; Max-Age=31536000; SameSite=Lax`
  );

  const destino = versao === 'mobile' ? '/mobile/' : '/';
  res.redirect(destino);
});

// ---- Rota: gerar número de cadastro único de 11 dígitos ----
function gerarNumeroCadastro() {
  let n;
  let tentativas = 0;
  do {
    n = String(crypto.randomInt(10000000000, 99999999999));
    tentativas++;
  } while (
    db.prepare('SELECT 1 FROM inscricoes WHERE numero_cadastro = ?').get(n) &&
    tentativas < 20
  );
  return n;
}

// ---- Rota: receber inscrição ----
app.post('/api/inscricao', (req, res) => {
  try {
    const b = req.body || {};

    const obrig = ['nome', 'data_nascimento', 'telefone', 'turma', 'emerg_nome', 'emerg_telefone'];
    for (const campo of obrig) {
      if (!b[campo] || !String(b[campo]).trim()) {
        return res.status(400).json({ ok: false, erro: `Campo obrigatório: ${campo}` });
      }
    }

    const norm = (t) => String(t || '').replace(/\D/g, '');
    if (norm(b.telefone) === norm(b.emerg_telefone)) {
      return res
        .status(400)
        .json({ ok: false, erro: 'O telefone de emergência não pode ser igual ao seu telefone.' });
    }

    const nasc = new Date(b.data_nascimento);
    if (isNaN(nasc.getTime())) {
      return res.status(400).json({ ok: false, erro: 'Data de nascimento inválida.' });
    }
    const hoje = new Date();
    let idade = hoje.getFullYear() - nasc.getFullYear();
    const m = hoje.getMonth() - nasc.getMonth();
    if (m < 0 || (m === 0 && hoje.getDate() < nasc.getDate())) idade--;
    if (idade < 0 || idade > 120) {
      return res.status(400).json({ ok: false, erro: 'Idade fora do intervalo permitido.' });
    }

    const menor = idade < 18;
    if (menor) {
      if (!b.resp_nome || !b.resp_nome.trim()) {
        return res
          .status(400)
          .json({ ok: false, erro: 'Responsável legal obrigatório para menores de 18 anos.' });
      }
      if (!b.resp_telefone || !b.resp_telefone.trim()) {
        return res.status(400).json({
          ok: false,
          erro: 'Telefone do responsável obrigatório para menores de 18 anos.',
        });
      }
    }

    if (b.autorizou_dados !== 'sim') {
      return res
        .status(400)
        .json({ ok: false, erro: 'É necessário autorizar o uso das informações de saúde.' });
    }

    const numero_cadastro = gerarNumeroCadastro();
    const data_preenchimento = new Date().toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
    });
    const responsavel_atendimento = 'BDST';

    const stmt = db.prepare(`
      INSERT INTO inscricoes (
        numero_cadastro, data_preenchimento, responsavel_atendimento,
        nome, data_nascimento, idade, telefone,
        turma, periodo, horario, ja_muaythai, ja_outra_arte, modalidade, tempo_pratica, objetivo,
        resp_nome, resp_parentesco, resp_telefone,
        emerg_nome, emerg_parentesco, emerg_telefone,
        saude_json, adaptacoes, autorizou_dados
      ) VALUES (
        @numero_cadastro, @data_preenchimento, @responsavel_atendimento,
        @nome, @data_nascimento, @idade, @telefone,
        @turma, @periodo, @horario, @ja_muaythai, @ja_outra_arte, @modalidade, @tempo_pratica, @objetivo,
        @resp_nome, @resp_parentesco, @resp_telefone,
        @emerg_nome, @emerg_parentesco, @emerg_telefone,
        @saude_json, @adaptacoes, @autorizou_dados
      )
    `);

    const saude = b.saude || {};
    const info = stmt.run({
      numero_cadastro,
      data_preenchimento,
      responsavel_atendimento,
      nome: b.nome.trim(),
      data_nascimento: b.data_nascimento,
      idade,
      telefone: b.telefone.trim(),
      turma: b.turma,
      periodo: b.periodo || null,
      horario: b.horario || null,
      ja_muaythai: b.ja_muaythai || null,
      ja_outra_arte: b.ja_outra_arte || null,
      modalidade: b.modalidade || null,
      tempo_pratica: b.tempo_pratica || null,
      objetivo: b.objetivo || null,
      resp_nome: menor ? b.resp_nome.trim() : null,
      resp_parentesco: menor ? b.resp_parentesco || null : null,
      resp_telefone: menor ? b.resp_telefone.trim() : null,
      emerg_nome: b.emerg_nome.trim(),
      emerg_parentesco: b.emerg_parentesco || null,
      emerg_telefone: b.emerg_telefone.trim(),
      saude_json: JSON.stringify(saude),
      adaptacoes: b.adaptacoes || null,
      autorizou_dados: b.autorizou_dados,
    });

    const idInscricao = info.lastInsertRowid;

    const contratoPath = path.join(CONTRATOS_DIR, `contrato_${numero_cadastro}.txt`);
    const contratoConteudo = gerarContrato({
      numero_cadastro,
      data_preenchimento,
      responsavel_atendimento,
      nome: b.nome.trim(),
      data_nascimento: b.data_nascimento,
      idade,
      telefone: b.telefone.trim(),
      turma: b.turma,
      periodo: b.periodo || '-',
      horario: b.horario || '-',
      resp_nome: menor ? b.resp_nome.trim() : null,
      resp_telefone: menor ? b.resp_telefone.trim() : null,
      emerg_nome: b.emerg_nome.trim(),
      emerg_telefone: b.emerg_telefone.trim(),
      adaptacoes: b.adaptacoes || 'Nenhuma informada',
      saude,
    });
    fs.writeFileSync(contratoPath, contratoConteudo, 'utf-8');

    db.prepare('UPDATE inscricoes SET contrato_path = ? WHERE id = ?').run(
      contratoPath,
      idInscricao
    );

    return res.json({
      ok: true,
      numero_cadastro,
      mensagem: 'Bem Vindo à Família Elite',
      contrato_arquivo: `contrato_${numero_cadastro}.txt`,
    });
  } catch (err) {
    console.error('Erro na inscrição:', err);
    return res.status(500).json({ ok: false, erro: 'Erro interno ao processar inscrição.' });
  }
});

// ---- Rota: baixar contrato ----
app.get('/api/contrato/:numero', (req, res) => {
  const { numero } = req.params;
  const row = db
    .prepare('SELECT contrato_path FROM inscricoes WHERE numero_cadastro = ?')
    .get(numero);
  if (!row || !row.contrato_path || !fs.existsSync(row.contrato_path)) {
    return res.status(404).send('Contrato não encontrado.');
  }
  res.download(row.contrato_path, `contrato_${numero}.txt`);
});

function gerarContrato(d) {
  const linhas = [];
  linhas.push('================================================================');
  linhas.push('       CONTRATO DE INSCRIÇÃO — ELITE COMBAT MUAY THAI');
  linhas.push('================================================================');
  linhas.push('');
  linhas.push(`Nº de Cadastro ..........: ${d.numero_cadastro}`);
  linhas.push(`Data de Preenchimento ...: ${d.data_preenchimento}`);
  linhas.push(`Atendente Responsável ...: ${d.responsavel_atendimento}`);
  linhas.push('');
  linhas.push('---------------- DADOS DO ALUNO ----------------');
  linhas.push(`Nome ....................: ${d.nome}`);
  linhas.push(`Data de Nascimento ......: ${d.data_nascimento}`);
  linhas.push(`Idade ...................: ${d.idade} anos`);
  linhas.push(`Telefone / WhatsApp .....: ${d.telefone}`);
  linhas.push(`Turma ...................: ${d.turma}`);
  linhas.push(`Período .................: ${d.periodo}`);
  linhas.push(`Horário .................: ${d.horario}`);
  if (d.resp_nome) {
    linhas.push('');
    linhas.push('--------- RESPONSÁVEL LEGAL (menor de 18) -------');
    linhas.push(`Nome ....................: ${d.resp_nome}`);
    linhas.push(`Telefone ................: ${d.resp_telefone}`);
  }
  linhas.push('');
  linhas.push('--------- CONTATO DE EMERGÊNCIA ---------');
  linhas.push(`Nome ....................: ${d.emerg_nome}`);
  linhas.push(`Telefone ................: ${d.emerg_telefone}`);
  linhas.push('');
  linhas.push('--------- SAÚDE E ADAPTAÇÕES ---------');
  const s = d.saude || {};
  const mapa = {
    q1: 'Condição médica que exige cuidado',
    q2: 'Condição psicológica / neurodesenvolvimento',
    q3: 'Deficiência / limitação física',
    q4: 'Histórico de lesão / cirurgia / fratura',
    q5: 'Medicamento contínuo',
    q6: 'Alergia relevante',
    q7: 'Desmaio / dor no peito / falta de ar',
    q8: 'Orientação médica para restringir exercícios',
  };
  Object.keys(mapa).forEach((k) => {
    const v = s[k] === 'sim' ? 'SIM' : 'NÃO';
    linhas.push(`[${v}] ${mapa[k]}`);
    if (s[k] === 'sim' && s[`${k}_detalhe`]) {
      linhas.push(`      → ${s[`${k}_detalhe`]}`);
    }
  });
  linhas.push('');
  linhas.push(`Adaptações / observações : ${d.adaptacoes}`);
  linhas.push('');
  linhas.push('--------- DECLARAÇÃO E AUTORIZAÇÃO ---------');
  linhas.push('O aluno (ou responsável legal) declara que as informações');
  linhas.push('acima são verdadeiras, está ciente de que o Muay Thai');
  linhas.push('envolve esforço físico, e autoriza o uso restrito das');
  linhas.push('informações de saúde pela equipe da Elite Combat para');
  linhas.push('fins de cuidado, segurança e adaptação do treino.');
  linhas.push('');
  linhas.push(`Local/Data .....: ${d.data_preenchimento}`);
  linhas.push(
    `Assinatura .....: ${d.nome}${d.resp_nome ? ' (responsável: ' + d.resp_nome + ')' : ''}`
  );
  linhas.push('');
  linhas.push('================================================================');
  linhas.push('   DOCUMENTO GERADO ELETRONICAMENTE — ELITE COMBAT');
  linhas.push('================================================================');
  return linhas.join('\n');
}

// ================== ADMIN ==================
const ADMIN_USER = 'MuayThai';
const ADMIN_PASS = 'NakMuay';

// Middleware de autenticação básica
function exigirAdmin(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Elite Combat Admin"');
    return res.status(401).send('Autenticação necessária.');
  }
  const [user, pass] = Buffer.from(auth.split(' ')[1], 'base64')
    .toString()
    .split(':');

  if (user === ADMIN_USER && pass === ADMIN_PASS) {
    return next();
  }
  res.setHeader('WWW-Authenticate', 'Basic realm="Elite Combat Admin"');
  return res.status(401).send('Usuário ou senha inválidos.');
}

// Página HTML do admin
app.get('/admin', exigirAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// API: listar todas as inscrições
app.get('/api/admin/inscricoes', exigirAdmin, (req, res) => {
  try {
    const rows = db
      .prepare(
        `SELECT id, numero_cadastro, data_preenchimento, nome, idade, telefone,
                turma, periodo, horario, objetivo,
                resp_nome, resp_telefone,
                emerg_nome, emerg_telefone,
                saude_json, adaptacoes,
                contrato_path, criado_em
         FROM inscricoes
         ORDER BY id DESC`
      )
      .all();

    // Parse do JSON de saúde
    const inscricoes = rows.map((r) => ({
      ...r,
      saude: r.saude_json ? JSON.parse(r.saude_json) : {},
      tem_contrato: !!(r.contrato_path && fs.existsSync(r.contrato_path)),
    }));

    return res.json({ ok: true, total: inscricoes.length, inscricoes });
  } catch (err) {
    console.error('Erro admin lista:', err);
    return res.status(500).json({ ok: false, erro: 'Erro ao listar inscrições.' });
  }
});

// API: exportar tudo em JSON (backup)
app.get('/api/admin/exportar', exigirAdmin, (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM inscricoes ORDER BY id ASC').all();
    const payload = {
      exportado_em: new Date().toISOString(),
      total: rows.length,
      inscricoes: rows,
    };
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="elite_combat_backup_${Date.now()}.json"`
    );
    res.setHeader('Content-Type', 'application/json');
    return res.send(JSON.stringify(payload, null, 2));
  } catch (err) {
    console.error('Erro admin export:', err);
    return res.status(500).json({ ok: false, erro: 'Erro ao exportar.' });
  }
});

// API: importar backup JSON
app.post('/api/admin/importar', exigirAdmin, express.json({ limit: '10mb' }), (req, res) => {
  try {
    const { inscricoes } = req.body || {};
    if (!Array.isArray(inscricoes)) {
      return res.status(400).json({ ok: false, erro: 'JSON inválido.' });
    }

    const stmt = db.prepare(`
      INSERT OR IGNORE INTO inscricoes (
        numero_cadastro, data_preenchimento, responsavel_atendimento,
        nome, data_nascimento, idade, telefone,
        turma, periodo, horario, ja_muaythai, ja_outra_arte, modalidade, tempo_pratica, objetivo,
        resp_nome, resp_parentesco, resp_telefone,
        emerg_nome, emerg_parentesco, emerg_telefone,
        saude_json, adaptacoes, autorizou_dados,
        contrato_path, criado_em
      ) VALUES (
        @numero_cadastro, @data_preenchimento, @responsavel_atendimento,
        @nome, @data_nascimento, @idade, @telefone,
        @turma, @periodo, @horario, @ja_muaythai, @ja_outra_arte, @modalidade, @tempo_pratica, @objetivo,
        @resp_nome, @resp_parentesco, @resp_telefone,
        @emerg_nome, @emerg_parentesco, @emerg_telefone,
        @saude_json, @adaptacoes, @autorizou_dados,
        @contrato_path, @criado_em
      )
    `);

    let importados = 0;
    const tx = db.transaction((lista) => {
      for (const r of lista) {
        // Só importa se número de cadastro existir
        if (!r.numero_cadastro) continue;
        const info = stmt.run({
          numero_cadastro: r.numero_cadastro,
          data_preenchimento: r.data_preenchimento || new Date().toLocaleString('pt-BR'),
          responsavel_atendimento: r.responsavel_atendimento || 'BDST',
          nome: r.nome || '',
          data_nascimento: r.data_nascimento || '',
          idade: r.idade || 0,
          telefone: r.telefone || '',
          turma: r.turma || '',
          periodo: r.periodo || null,
          horario: r.horario || null,
          ja_muaythai: r.ja_muaythai || null,
          ja_outra_arte: r.ja_outra_arte || null,
          modalidade: r.modalidade || null,
          tempo_pratica: r.tempo_pratica || null,
          objetivo: r.objetivo || null,
          resp_nome: r.resp_nome || null,
          resp_parentesco: r.resp_parentesco || null,
          resp_telefone: r.resp_telefone || null,
          emerg_nome: r.emerg_nome || '',
          emerg_parentesco: r.emerg_parentesco || null,
          emerg_telefone: r.emerg_telefone || '',
          saude_json: r.saude_json || '{}',
          adaptacoes: r.adaptacoes || null,
          autorizou_dados: r.autorizou_dados || 'sim',
          contrato_path: null, // será regenerado no próximo download
          criado_em: r.criado_em || new Date().toISOString(),
        });
        if (info.changes > 0) importados++;
      }
    });

    tx(inscricoes);
    return res.json({ ok: true, importados, ignorados: inscricoes.length - importados });
  } catch (err) {
    console.error('Erro admin import:', err);
    return res.status(500).json({ ok: false, erro: 'Erro ao importar.' });
  }
});

// API: remover inscrição
app.delete('/api/admin/inscricao/:numero', exigirAdmin, (req, res) => {
  try {
    const { numero } = req.params;
    const row = db
      .prepare('SELECT contrato_path FROM inscricoes WHERE numero_cadastro = ?')
      .get(numero);

    if (!row) return res.status(404).json({ ok: false, erro: 'Não encontrado.' });

    // Remove arquivo de contrato
    if (row.contrato_path && fs.existsSync(row.contrato_path)) {
      try { fs.unlinkSync(row.contrato_path); } catch (e) {}
    }

    db.prepare('DELETE FROM inscricoes WHERE numero_cadastro = ?').run(numero);
    return res.json({ ok: true });
  } catch (err) {
    console.error('Erro admin delete:', err);
    return res.status(500).json({ ok: false, erro: 'Erro ao remover.' });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor Elite Combat rodando em http://localhost:${PORT}`);
});