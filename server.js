const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { createClient } = require('@libsql/client');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;

// ================== BANCO DE DADOS ==================
const DB_DIR = path.join(__dirname, 'database');
const CONTRATOS_DIR = path.join(DB_DIR, 'contratos');
const usaTurso = process.env.DATABASE_PROVIDER === 'turso';
const estaNoRender = Boolean(
  process.env.RENDER || process.env.RENDER_SERVICE_ID || process.env.RENDER_EXTERNAL_URL
);
if (estaNoRender && !usaTurso) {
  throw new Error('Configure DATABASE_PROVIDER=turso e as credenciais do Turso no Render.');
}
if (usaTurso && (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN)) {
  throw new Error('DATABASE_PROVIDER=turso exige TURSO_DATABASE_URL e TURSO_AUTH_TOKEN.');
}

let db;
if (usaTurso) {
  db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
} else {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  if (!fs.existsSync(CONTRATOS_DIR)) fs.mkdirSync(CONTRATOS_DIR, { recursive: true });
  db = new Database(path.join(DB_DIR, 'elite_combat.db'));
  db.pragma('journal_mode = WAL');
}

function converterLinha(row, columns) {
  return Object.fromEntries(columns.map((column, index) => {
    const value = row[index];
    return [column, typeof value === 'bigint' ? Number(value) : value];
  }));
}

async function consultarTudo(sql, args = [], connection = db) {
  if (!usaTurso) {
    const statement = connection.prepare(sql);
    return Array.isArray(args) ? statement.all(...args) : statement.all(args);
  }
  const result = await connection.execute({ sql, args });
  return result.rows.map((row) => converterLinha(row, result.columns));
}

async function consultarUm(sql, args = [], connection = db) {
  if (!usaTurso) {
    const statement = connection.prepare(sql);
    return Array.isArray(args) ? statement.get(...args) : statement.get(args);
  }
  const result = await connection.execute({ sql, args });
  return result.rows.length ? converterLinha(result.rows[0], result.columns) : undefined;
}

async function executar(sql, args = [], connection = db) {
  if (!usaTurso) {
    const statement = connection.prepare(sql);
    return Array.isArray(args) ? statement.run(...args) : statement.run(args);
  }
  const result = await connection.execute({ sql, args });
  return {
    changes: result.rowsAffected,
    lastInsertRowid: result.lastInsertRowid === undefined
      ? undefined
      : Number(result.lastInsertRowid),
  };
}

async function executarDDL(sql) {
  if (usaTurso) {
    await db.execute(sql);
  } else {
    db.exec(sql);
  }
}

async function executarLote(statements) {
  if (usaTurso) {
    return db.batch(statements, 'write');
  }
  const transaction = db.transaction(() => {
    const results = [];
    for (const statement of statements) {
      const prepared = db.prepare(statement.sql);
      results.push(
        Array.isArray(statement.args)
          ? prepared.run(...statement.args)
          : prepared.run(statement.args || {})
      );
    }
    return results;
  });
  return transaction();
}

async function inicializarBanco() {
  await executarDDL(`
    CREATE TABLE IF NOT EXISTS inscricoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      numero_cadastro TEXT UNIQUE NOT NULL,
      data_preenchimento TEXT NOT NULL,
      responsavel_atendimento TEXT NOT NULL,
      nome TEXT NOT NULL,
      data_nascimento TEXT NOT NULL,
      idade INTEGER NOT NULL,
      telefone TEXT NOT NULL,
      turma TEXT NOT NULL,
      turma_aula TEXT,
      periodo TEXT,
      horario TEXT,
      ja_muaythai TEXT,
      ja_outra_arte TEXT,
      modalidade TEXT,
      tempo_pratica TEXT,
      objetivo TEXT,
      tipo_inscricao TEXT NOT NULL DEFAULT 'aluno',
      autorizacao_instrutor INTEGER NOT NULL DEFAULT 0,
      resp_nome TEXT,
      resp_parentesco TEXT,
      resp_telefone TEXT,
      emerg_nome TEXT NOT NULL,
      emerg_parentesco TEXT,
      emerg_telefone TEXT NOT NULL,
      saude_json TEXT,
      adaptacoes TEXT,
      autorizou_dados TEXT,
      contrato_path TEXT,
      contrato_conteudo TEXT,
      criado_em TEXT DEFAULT (datetime('now'))
    );
  `);

  const colunasInscricao = new Set(
    (await consultarTudo('PRAGMA table_info(inscricoes)')).map((coluna) => coluna.name)
  );
  const migracoesInscricao = [
    ['tipo_inscricao', "ALTER TABLE inscricoes ADD COLUMN tipo_inscricao TEXT NOT NULL DEFAULT 'aluno'"],
    ['autorizacao_instrutor', 'ALTER TABLE inscricoes ADD COLUMN autorizacao_instrutor INTEGER NOT NULL DEFAULT 0'],
    ['turma_aula', 'ALTER TABLE inscricoes ADD COLUMN turma_aula TEXT'],
    ['contrato_conteudo', 'ALTER TABLE inscricoes ADD COLUMN contrato_conteudo TEXT'],
  ];
  for (const [coluna, sql] of migracoesInscricao) {
    if (!colunasInscricao.has(coluna)) await executarDDL(sql);
  }

  await executarDDL(`
    CREATE TABLE IF NOT EXISTS feedbacks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      numero_cadastro TEXT,
      email TEXT,
      nota INTEGER NOT NULL CHECK (nota BETWEEN 1 AND 5),
      recomendacao TEXT NOT NULL,
      criado_em TEXT NOT NULL DEFAULT (datetime('now')),
      atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const colunasFeedback = await consultarTudo('PRAGMA table_info(feedbacks)');
  const usaCadastroComoChave = colunasFeedback.some(
    (coluna) => coluna.name === 'numero_cadastro' && coluna.pk > 0
  );
  if (usaCadastroComoChave) {
    const possuiEmail = colunasFeedback.some((coluna) => coluna.name === 'email');
    const feedbacksAntigos = await consultarTudo(`
      SELECT numero_cadastro, nota, recomendacao,
             ${possuiEmail ? 'email' : 'NULL AS email'},
             criado_em, atualizado_em
      FROM feedbacks
      ORDER BY atualizado_em DESC, criado_em DESC
    `);
    const statements = [
      { sql: 'ALTER TABLE feedbacks RENAME TO feedbacks_por_cadastro' },
      {
        sql: `CREATE TABLE feedbacks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          numero_cadastro TEXT,
          email TEXT,
          nota INTEGER NOT NULL CHECK (nota BETWEEN 1 AND 5),
          recomendacao TEXT NOT NULL,
          criado_em TEXT NOT NULL DEFAULT (datetime('now')),
          atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
        )`,
      },
    ];
    const emailsVistos = new Set();
    for (const linha of feedbacksAntigos) {
      const email = String(linha.email || '').trim() || null;
      const chaveEmail = email ? email.toLocaleLowerCase('en-US') : null;
      if (chaveEmail && emailsVistos.has(chaveEmail)) continue;
      if (chaveEmail) emailsVistos.add(chaveEmail);
      statements.push({
        sql: `INSERT INTO feedbacks
          (numero_cadastro, email, nota, recomendacao, criado_em, atualizado_em)
          VALUES (?, ?, ?, ?, ?, ?)`,
        args: [
          linha.numero_cadastro,
          email,
          linha.nota,
          linha.recomendacao,
          linha.criado_em,
          linha.atualizado_em,
        ],
      });
    }
    statements.push({ sql: 'DROP TABLE feedbacks_por_cadastro' });
    await executarLote(statements);
  }

  await executarDDL(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_feedbacks_email
    ON feedbacks(email COLLATE NOCASE)
    WHERE email IS NOT NULL;
  `);
}

function normalizarTelefone(valor) {
  const digits = String(valor || '').replace(/\D/g, '');
  return digits.startsWith('55') && (digits.length === 12 || digits.length === 13)
    ? digits.slice(2)
    : digits;
}

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

app.get('/api/feedback', async (req, res) => {
  try {
    const feedbacks = await consultarTudo(`
      SELECT email, nota, recomendacao, atualizado_em
      FROM feedbacks
      WHERE email IS NOT NULL
      ORDER BY atualizado_em DESC
      LIMIT 50
    `);
    return res.json({ ok: true, feedbacks });
  } catch (err) {
    console.error('Erro ao listar feedbacks:', err);
    return res.status(500).json({ ok: false, erro: 'Não foi possível carregar os feedbacks.' });
  }
});

app.post('/api/feedback', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim();
    const recomendacao = String(req.body?.recomendacao || '').trim();
    const nota = Number(req.body?.nota);
    const consentimento = req.body?.consentimento === true;

    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ ok: false, erro: 'Informe um endereço de e-mail válido.' });
    }
    if (!Number.isInteger(nota) || nota < 1 || nota > 5) {
      return res.status(400).json({ ok: false, erro: 'Escolha uma nota de 1 a 5.' });
    }
    if (recomendacao.length < 5 || recomendacao.length > 1000) {
      return res.status(400).json({
        ok: false,
        erro: 'A recomendação deve ter entre 5 e 1000 caracteres.',
      });
    }
    if (!consentimento) {
      return res.status(400).json({
        ok: false,
        erro: 'Autorize a publicação da sua avaliação junto ao e-mail informado.',
      });
    }

    const emailExistente = await consultarUm(
      'SELECT id FROM feedbacks WHERE email = ? COLLATE NOCASE',
      [email]
    );
    if (emailExistente) {
      await executar(`
        UPDATE feedbacks
        SET email = ?, nota = ?, recomendacao = ?, atualizado_em = datetime('now')
        WHERE id = ?
      `, [email, nota, recomendacao, emailExistente.id]);
    } else {
      await executar(`
        INSERT INTO feedbacks (email, nota, recomendacao)
        VALUES (?, ?, ?)
      `, [email, nota, recomendacao]);
    }

    return res.json({
      ok: true,
      mensagem: 'Obrigado por compartilhar sua avaliação!',
      email,
    });
  } catch (err) {
    console.error('Erro ao salvar feedback:', err);
    return res.status(500).json({ ok: false, erro: 'Não foi possível enviar o feedback.' });
  }
});

// ---- Rota: gerar número de cadastro único de 11 dígitos ----
async function gerarNumeroCadastro() {
  let n;
  let tentativas = 0;
  do {
    n = String(crypto.randomInt(10000000000, 99999999999));
    tentativas++;
  } while (
    await consultarUm('SELECT 1 FROM inscricoes WHERE numero_cadastro = ?', [n]) &&
    tentativas < 20
  );
  return n;
}

// ---- Rota: receber inscrição ----
app.post('/api/inscricao', async (req, res) => {
  try {
    const b = req.body || {};

    const obrig = ['nome', 'data_nascimento', 'telefone'];
    for (const campo of obrig) {
      if (!b[campo] || !String(b[campo]).trim()) {
        return res.status(400).json({ ok: false, erro: `Campo obrigatório: ${campo}` });
      }
    }

    const nasc = new Date(b.data_nascimento);
    if (isNaN(nasc.getTime())) {
      return res.status(400).json({ ok: false, erro: 'Data de nascimento inválida.' });
    }
    const hoje = new Date();
    let idade = hoje.getFullYear() - nasc.getFullYear();
    const m = hoje.getMonth() - nasc.getMonth();
    if (m < 0 || (m === 0 && hoje.getDate() < nasc.getDate())) idade--;
    if (idade < 4) {
      return res.status(400).json({ ok: false, erro: 'A idade mínima para inscrição é 4 anos.' });
    }
    if (idade > 120) {
      return res.status(400).json({ ok: false, erro: 'Idade fora do intervalo permitido.' });
    }

    const turma = idade < 7 ? 'Baby Thai (4 a 6 anos)' :
      idade < 14 ? 'Kids (7 a 13 anos)' : 'Juvenil / Adulto (14+)';
    const tipo_inscricao = b.tipo_inscricao || 'aluno';
    if (!['aluno', 'instrutor'].includes(tipo_inscricao)) {
      return res.status(400).json({ ok: false, erro: 'Tipo de inscrição inválido.' });
    }
    const autorizacao_instrutor = tipo_inscricao === 'instrutor' && b.autorizacao_instrutor === true;
    if (tipo_inscricao === 'instrutor' && !autorizacao_instrutor) {
      return res.status(400).json({
        ok: false,
        erro: 'Confirme a autorização do professor para a inscrição como Instrutor Elite.',
      });
    }
    if (tipo_inscricao === 'instrutor') {
      const periodosValidos = ['Manhã', 'Tarde', 'Noite', 'A definir'];
      const turmasAulaValidas = ['Baby Thai', 'Kids', 'Juvenil / Adulto', 'A definir'];
      if (!periodosValidos.includes(b.periodo)) {
        return res.status(400).json({ ok: false, erro: 'Informe o horário de treino.' });
      }
      if (!turmasAulaValidas.includes(b.turma_aula)) {
        return res.status(400).json({ ok: false, erro: 'Informe a turma de aula.' });
      }
      if (!String(b.horario || '').trim()) {
        return res.status(400).json({ ok: false, erro: 'Informe o horário da aula ou selecione "A definir".' });
      }
    }

    const menor = idade < 18;
    if (menor) {
      if (!String(b.resp_nome || '').trim()) {
        return res
          .status(400)
          .json({ ok: false, erro: 'Responsável legal obrigatório para menores de 18 anos.' });
      }
      if (!String(b.resp_telefone || '').trim()) {
        return res.status(400).json({
          ok: false,
          erro: 'Telefone do responsável obrigatório para menores de 18 anos.',
        });
      }
      if (!String(b.emerg_nome || '').trim() || !String(b.emerg_telefone || '').trim()) {
        return res.status(400).json({
          ok: false,
          erro: 'Contato de emergência obrigatório para menores de 18 anos.',
        });
      }
    }

    const norm = (t) => String(t || '').replace(/\D/g, '');
    if (b.emerg_telefone && norm(b.telefone) === norm(b.emerg_telefone)) {
      return res
        .status(400)
        .json({ ok: false, erro: 'O telefone de emergência não pode ser igual ao seu telefone.' });
    }

    if (b.autorizou_dados !== 'sim') {
      return res
        .status(400)
        .json({ ok: false, erro: 'É necessário autorizar o uso das informações de saúde.' });
    }

    const numero_cadastro = await gerarNumeroCadastro();
    const data_preenchimento = new Date().toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
    });
    const responsavel_atendimento = 'BDST';

    const insertSql = `
      INSERT INTO inscricoes (
        numero_cadastro, data_preenchimento, responsavel_atendimento,
        nome, data_nascimento, idade, telefone,
        turma, turma_aula, periodo, horario, ja_muaythai, ja_outra_arte, modalidade, tempo_pratica, objetivo,
        tipo_inscricao, autorizacao_instrutor,
        resp_nome, resp_parentesco, resp_telefone,
        emerg_nome, emerg_parentesco, emerg_telefone,
        saude_json, adaptacoes, autorizou_dados
      ) VALUES (
        @numero_cadastro, @data_preenchimento, @responsavel_atendimento,
        @nome, @data_nascimento, @idade, @telefone,
        @turma, @turma_aula, @periodo, @horario, @ja_muaythai, @ja_outra_arte, @modalidade, @tempo_pratica, @objetivo,
        @tipo_inscricao, @autorizacao_instrutor,
        @resp_nome, @resp_parentesco, @resp_telefone,
        @emerg_nome, @emerg_parentesco, @emerg_telefone,
        @saude_json, @adaptacoes, @autorizou_dados
      )
    `;

    const saude = b.saude || {};
    const dadosInscricao = {
      numero_cadastro,
      data_preenchimento,
      responsavel_atendimento,
      nome: b.nome.trim(),
      data_nascimento: b.data_nascimento,
      idade,
      telefone: b.telefone.trim(),
      turma,
      turma_aula: tipo_inscricao === 'instrutor' ? b.turma_aula || null : null,
      periodo: b.periodo || null,
      horario: b.horario || null,
      ja_muaythai: tipo_inscricao === 'instrutor' ? null : b.ja_muaythai || null,
      ja_outra_arte: tipo_inscricao === 'instrutor' ? null : b.ja_outra_arte || null,
      modalidade: tipo_inscricao === 'instrutor' ? null : b.modalidade || null,
      tempo_pratica: tipo_inscricao === 'instrutor' ? null : b.tempo_pratica || null,
      objetivo: b.objetivo || null,
      tipo_inscricao,
      autorizacao_instrutor: autorizacao_instrutor ? 1 : 0,
      resp_nome: menor ? b.resp_nome.trim() : null,
      resp_parentesco: menor ? b.resp_parentesco || null : null,
      resp_telefone: menor ? b.resp_telefone.trim() : null,
      emerg_nome: String(b.emerg_nome || '').trim(),
      emerg_parentesco: b.emerg_parentesco || null,
      emerg_telefone: String(b.emerg_telefone || '').trim(),
      saude_json: JSON.stringify(saude),
      adaptacoes: b.adaptacoes || null,
      autorizou_dados: b.autorizou_dados,
    };

    const info = await executar(insertSql, dadosInscricao);
    const idInscricao = info.lastInsertRowid;

    const contratoPath = usaTurso
      ? null
      : path.join(CONTRATOS_DIR, `contrato_${numero_cadastro}.txt`);
    const contratoConteudo = gerarContrato({
      numero_cadastro,
      data_preenchimento,
      responsavel_atendimento,
      nome: b.nome.trim(),
      data_nascimento: b.data_nascimento,
      idade,
      telefone: b.telefone.trim(),
      turma,
      turma_aula: tipo_inscricao === 'instrutor' ? b.turma_aula || 'A definir' : null,
      tipo_inscricao,
      autorizacao_instrutor,
      periodo: b.periodo || '-',
      horario: b.horario || '-',
      resp_nome: menor ? b.resp_nome.trim() : null,
      resp_telefone: menor ? b.resp_telefone.trim() : null,
      emerg_nome: String(b.emerg_nome || '').trim() || 'Não informado',
      emerg_telefone: String(b.emerg_telefone || '').trim() || 'Não informado',
      adaptacoes: b.adaptacoes || 'Nenhuma informada',
      saude,
    });
    if (contratoPath) fs.writeFileSync(contratoPath, contratoConteudo, 'utf-8');

    await executar(
      'UPDATE inscricoes SET contrato_path = ?, contrato_conteudo = ? WHERE id = ?',
      [contratoPath, contratoConteudo, idInscricao]
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
app.get('/api/contrato/:numero', async (req, res) => {
  const { numero } = req.params;
  try {
    const row = await consultarUm(
      'SELECT * FROM inscricoes WHERE numero_cadastro = ?',
      [numero]
    );
    if (!row) return res.status(404).send('Contrato não encontrado.');

    let conteudo = row.contrato_conteudo;
    if (!conteudo && row.contrato_path && fs.existsSync(row.contrato_path)) {
      conteudo = fs.readFileSync(row.contrato_path, 'utf-8');
    }
    if (!conteudo) {
      let saude = {};
      try {
        saude = row.saude_json ? JSON.parse(row.saude_json) : {};
      } catch (err) {
        console.error('Erro ao ler dados de saúde do contrato:', err);
        return res.status(500).send('Não foi possível gerar o contrato.');
      }
      conteudo = gerarContrato({
        ...row,
        saude,
        adaptacoes: row.adaptacoes || 'Nenhuma informada',
        emerg_nome: row.emerg_nome || 'Não informado',
        emerg_telefone: row.emerg_telefone || 'Não informado',
      });
      await executar(
        'UPDATE inscricoes SET contrato_conteudo = ? WHERE numero_cadastro = ?',
        [conteudo, numero]
      );
    }
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="contrato_${numero}.txt"`);
    res.setHeader('Cache-Control', 'no-store');
    return res.send(conteudo);
  } catch (err) {
    console.error('Erro ao consultar contrato:', err);
    return res.status(500).send('Não foi possível consultar o contrato.');
  }
});

// ---- Rota: consultar inscrição pelo app autenticado ----
app.get('/api/integracao/inscricao', async (req, res) => {
  const expectedToken = process.env.REGISTRATION_API_TOKEN || '';
  const providedToken = String(req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const expectedBuffer = Buffer.from(expectedToken);
  const providedBuffer = Buffer.from(providedToken);

  if (!expectedToken) {
    return res.status(503).json({ ok: false, erro: 'Integração não configurada.' });
  }
  if (
    expectedBuffer.length !== providedBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, providedBuffer)
  ) {
    return res.status(401).json({ ok: false, erro: 'Não autorizado.' });
  }

  const numero = String(req.query.numero || '');
  const telefone = String(req.query.telefone || '').replace(/\D/g, '');
  if (!/^\d{11}$/.test(numero) || (telefone && !/^\d{10,13}$/.test(telefone))) {
    return res.status(400).json({ ok: false, erro: 'Número de cadastro ou telefone inválido.' });
  }

  let row;
  try {
    row = await consultarUm('SELECT * FROM inscricoes WHERE numero_cadastro = ?', [numero]);
  } catch (err) {
    console.error('Erro ao consultar inscrição da integração:', err);
    return res.status(500).json({ ok: false, erro: 'Não foi possível consultar a inscrição.' });
  }

  if (!row || (telefone && normalizarTelefone(row.telefone) !== normalizarTelefone(telefone))) {
    return res.status(404).json({ ok: false, erro: 'Inscrição não encontrada.' });
  }

  let saude;
  try {
    saude = row.saude_json ? JSON.parse(row.saude_json) : {};
  } catch (err) {
    console.error('Erro ao ler dados de saúde da inscrição:', err);
    return res.status(500).json({ ok: false, erro: 'Não foi possível ler a ficha de inscrição.' });
  }

  return res.json({
    ok: true,
    inscricao: {
      numero_cadastro: row.numero_cadastro,
      data_preenchimento: row.data_preenchimento,
      responsavel_atendimento: row.responsavel_atendimento,
      nome: row.nome,
      data_nascimento: row.data_nascimento,
      idade: row.idade,
      telefone: row.telefone,
      turma: row.turma,
      tipo_inscricao: row.tipo_inscricao || 'aluno',
      autorizacao_instrutor: !!row.autorizacao_instrutor,
      turma_aula: row.turma_aula,
      periodo: row.periodo,
      horario: row.horario,
      ja_muaythai: row.ja_muaythai,
      ja_outra_arte: row.ja_outra_arte,
      modalidade: row.modalidade,
      tempo_pratica: row.tempo_pratica,
      objetivo: row.objetivo,
      resp_nome: row.resp_nome,
      resp_parentesco: row.resp_parentesco,
      resp_telefone: row.resp_telefone,
      emerg_nome: row.emerg_nome,
      emerg_parentesco: row.emerg_parentesco,
      emerg_telefone: row.emerg_telefone,
      saude,
      adaptacoes: row.adaptacoes,
      autorizou_dados: row.autorizou_dados,
      contrato_disponivel: true,
    },
  });
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
  linhas.push(`Tipo de inscrição .......: ${d.tipo_inscricao === 'instrutor' ? 'Instrutor Elite' : 'Aluno'}`);
  if (d.tipo_inscricao === 'instrutor' && d.autorizacao_instrutor) {
    linhas.push('Autorização professor ...: Confirmada');
  }
  if (d.tipo_inscricao === 'instrutor') {
    linhas.push(`Turma de aula ...........: ${d.turma_aula || 'A definir'}`);
    linhas.push(`Horário de treino .......: ${d.periodo || 'A definir'}`);
    linhas.push(`Horário da aula .........: ${d.horario || 'A definir'}`);
  } else {
    linhas.push(`Período .................: ${d.periodo}`);
    linhas.push(`Horário .................: ${d.horario}`);
  }
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
const ADMIN_SESSION_COOKIE = 'elite_admin_session';
const ADMIN_SESSION_TTL_SECONDS = 8 * 60 * 60;

function compararSegredos(valor, esperado) {
  const recebido = Buffer.from(String(valor || ''));
  const correto = Buffer.from(esperado);
  return recebido.length === correto.length && crypto.timingSafeEqual(recebido, correto);
}

function criarSessaoAdmin(expiraEm) {
  const assinatura = crypto
    .createHmac('sha256', ADMIN_PASS)
    .update(String(expiraEm))
    .digest('hex');
  return `${expiraEm}.${assinatura}`;
}

function sessaoAdminValida(req) {
  const cookies = String(req.headers.cookie || '').split(';');
  const cookie = cookies
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${ADMIN_SESSION_COOKIE}=`));
  if (!cookie) return false;

  const token = cookie.slice(ADMIN_SESSION_COOKIE.length + 1);
  const [expiraTexto, assinatura] = token.split('.');
  const expiraEm = Number(expiraTexto);
  if (!Number.isSafeInteger(expiraEm) || expiraEm <= Date.now() || !assinatura) {
    return false;
  }

  return compararSegredos(assinatura, criarSessaoAdmin(expiraEm).split('.')[1]);
}

// Aceita a sessão do painel desktop e mantém compatibilidade com o painel mobile.
function exigirAdmin(req, res, next) {
  if (sessaoAdminValida(req)) return next();

  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Basic ')) {
    if (req.path !== '/api/admin/sessao') {
      res.setHeader('WWW-Authenticate', 'Basic realm="Elite Combat Admin"');
    }
    return res.status(401).send('Autenticação necessária.');
  }
  let credenciais;
  try {
    credenciais = Buffer.from(auth.slice(6), 'base64').toString('utf-8');
  } catch (err) {
    return res.status(401).send('Usuário ou senha inválidos.');
  }
  const separador = credenciais.indexOf(':');
  if (separador < 0) {
    if (req.path !== '/api/admin/sessao') {
      res.setHeader('WWW-Authenticate', 'Basic realm="Elite Combat Admin"');
    }
    return res.status(401).send('Usuário ou senha inválidos.');
  }
  const user = credenciais.slice(0, separador);
  const pass = credenciais.slice(separador + 1);

  if (compararSegredos(user, ADMIN_USER) && compararSegredos(pass, ADMIN_PASS)) {
    return next();
  }
  if (req.path !== '/api/admin/sessao') {
    res.setHeader('WWW-Authenticate', 'Basic realm="Elite Combat Admin"');
  }
  return res.status(401).send('Usuário ou senha inválidos.');
}

// Página HTML do admin
app.get('/admin', (req, res) => {
  if (ehDispositivoMovel(req)) {
    return res.redirect('/admin/mobile');
  }
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/admin/mobile', exigirAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-mobile.html'));
});

app.post('/api/admin/login', (req, res) => {
  const usuario = String(req.body?.usuario || '');
  const senha = String(req.body?.senha || '');
  if (!compararSegredos(usuario, ADMIN_USER) || !compararSegredos(senha, ADMIN_PASS)) {
    return res.status(401).json({ ok: false, erro: 'Usuário ou senha inválidos.' });
  }

  const expiraEm = Date.now() + ADMIN_SESSION_TTL_SECONDS * 1000;
  const secure = estaNoRender || req.secure ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${ADMIN_SESSION_COOKIE}=${criarSessaoAdmin(expiraEm)}; Path=/; Max-Age=${ADMIN_SESSION_TTL_SECONDS}; HttpOnly; SameSite=Strict${secure}`
  );
  res.setHeader('Cache-Control', 'no-store');
  return res.json({ ok: true });
});

app.get('/api/admin/sessao', exigirAdmin, (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  return res.json({ ok: true });
});

app.post('/api/admin/logout', (req, res) => {
  const secure = estaNoRender || req.secure ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${ADMIN_SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict${secure}`
  );
  return res.json({ ok: true });
});

app.get('/api/admin/feedback', exigirAdmin, async (req, res) => {
  try {
    const feedbacks = await consultarTudo(`
      SELECT id, email, nota, recomendacao, atualizado_em
      FROM feedbacks
      ORDER BY atualizado_em DESC
    `);
    return res.json({ ok: true, feedbacks });
  } catch (err) {
    console.error('Erro admin feedbacks:', err);
    return res.status(500).json({ ok: false, erro: 'Erro ao listar feedbacks.' });
  }
});

app.delete('/api/admin/feedback/:id', exigirAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) {
      return res.status(400).json({ ok: false, erro: 'Identificador de feedback inválido.' });
    }
    const resultado = await executar('DELETE FROM feedbacks WHERE id = ?', [id]);
    if (!resultado.changes) {
      return res.status(404).json({ ok: false, erro: 'Feedback não encontrado.' });
    }
    return res.json({ ok: true, mensagem: 'Feedback removido.' });
  } catch (err) {
    console.error('Erro admin ao remover feedback:', err);
    return res.status(500).json({ ok: false, erro: 'Erro ao remover feedback.' });
  }
});

// API: listar todas as inscrições
app.get('/api/admin/inscricoes', exigirAdmin, async (req, res) => {
  try {
    const rows = await consultarTudo(
      `SELECT id, numero_cadastro, data_preenchimento, nome, idade, telefone,
                turma, tipo_inscricao, autorizacao_instrutor, turma_aula, periodo, horario, objetivo,
                resp_nome, resp_telefone,
                emerg_nome, emerg_telefone,
                saude_json, adaptacoes,
                contrato_path, contrato_conteudo, criado_em
         FROM inscricoes
         ORDER BY id DESC`
    );

    // Parse do JSON de saúde
    const inscricoes = rows.map((r) => ({
      ...r,
      saude: r.saude_json ? JSON.parse(r.saude_json) : {},
      tem_contrato: true,
    }));

    return res.json({ ok: true, total: inscricoes.length, inscricoes });
  } catch (err) {
    console.error('Erro admin lista:', err);
    return res.status(500).json({ ok: false, erro: 'Erro ao listar inscrições.' });
  }
});

// API: exportar tudo em JSON (backup)
app.get('/api/admin/exportar', exigirAdmin, async (req, res) => {
  try {
    const [rows, feedbacks] = await Promise.all([
      consultarTudo('SELECT * FROM inscricoes ORDER BY id ASC'),
      consultarTudo('SELECT * FROM feedbacks ORDER BY id ASC'),
    ]);
    const payload = {
      exportado_em: new Date().toISOString(),
      total: rows.length,
      inscricoes: rows,
      feedbacks,
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
app.post('/api/admin/importar', exigirAdmin, express.json({ limit: '10mb' }), async (req, res) => {
  try {
    const { inscricoes, feedbacks = [] } = req.body || {};
    if (!Array.isArray(inscricoes)) {
      return res.status(400).json({ ok: false, erro: 'JSON inválido.' });
    }
    if (!Array.isArray(feedbacks)) {
      return res.status(400).json({ ok: false, erro: 'Lista de feedbacks inválida.' });
    }

    const insertSql = `
      INSERT OR IGNORE INTO inscricoes (
        numero_cadastro, data_preenchimento, responsavel_atendimento,
        nome, data_nascimento, idade, telefone,
        turma, turma_aula, periodo, horario, ja_muaythai, ja_outra_arte, modalidade, tempo_pratica, objetivo,
        tipo_inscricao, autorizacao_instrutor,
        resp_nome, resp_parentesco, resp_telefone,
        emerg_nome, emerg_parentesco, emerg_telefone,
        saude_json, adaptacoes, autorizou_dados,
        contrato_path, contrato_conteudo, criado_em
      ) VALUES (
        @numero_cadastro, @data_preenchimento, @responsavel_atendimento,
        @nome, @data_nascimento, @idade, @telefone,
        @turma, @turma_aula, @periodo, @horario, @ja_muaythai, @ja_outra_arte, @modalidade, @tempo_pratica, @objetivo,
        @tipo_inscricao, @autorizacao_instrutor,
        @resp_nome, @resp_parentesco, @resp_telefone,
        @emerg_nome, @emerg_parentesco, @emerg_telefone,
        @saude_json, @adaptacoes, @autorizou_dados,
        @contrato_path, @contrato_conteudo, @criado_em
      )
    `;

    const statements = [];
    for (const r of inscricoes) {
      if (!r.numero_cadastro) continue;
      statements.push({
        sql: insertSql,
        args: {
          numero_cadastro: r.numero_cadastro,
          data_preenchimento: r.data_preenchimento || new Date().toLocaleString('pt-BR'),
          responsavel_atendimento: r.responsavel_atendimento || 'BDST',
          nome: r.nome || '',
          data_nascimento: r.data_nascimento || '',
          idade: r.idade || 0,
          telefone: r.telefone || '',
          turma: r.turma || '',
          turma_aula: r.turma_aula || null,
          tipo_inscricao: r.tipo_inscricao || 'aluno',
          autorizacao_instrutor: r.autorizacao_instrutor ? 1 : 0,
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
          contrato_path: usaTurso ? null : r.contrato_path || null,
          contrato_conteudo: r.contrato_conteudo || null,
          criado_em: r.criado_em || new Date().toISOString(),
        },
      });
    }

    for (const feedback of feedbacks) {
      if (!feedback.email || !Number.isInteger(Number(feedback.nota))) continue;
      statements.push({
        sql: `
          INSERT OR IGNORE INTO feedbacks (email, nota, recomendacao, atualizado_em)
          VALUES (?, ?, ?, ?)
        `,
        args: [
          String(feedback.email).trim().toLowerCase(),
          Number(feedback.nota),
          String(feedback.recomendacao || ''),
          feedback.atualizado_em || new Date().toISOString(),
        ],
      });
    }
    const quantidadeInscricoes = inscricoes.filter((r) => r.numero_cadastro).length;
    const resultados = statements.length ? await executarLote(statements) : [];
    const totalAlteracoes = (lista) => lista.reduce((total, resultado) => {
      const alteracoes = resultado.changes === undefined
        ? resultado.rowsAffected
        : resultado.changes;
      return total + (alteracoes > 0 ? 1 : 0);
    }, 0);
    const importados = totalAlteracoes(resultados.slice(0, quantidadeInscricoes));
    const feedbacksImportados = totalAlteracoes(resultados.slice(quantidadeInscricoes));
    return res.json({
      ok: true,
      importados,
      ignorados: inscricoes.length - importados,
      feedbacks_importados: feedbacksImportados,
      feedbacks_ignorados: feedbacks.length - feedbacksImportados,
    });
  } catch (err) {
    console.error('Erro admin import:', err);
    return res.status(500).json({ ok: false, erro: 'Erro ao importar.' });
  }
});

// API: remover inscrição
app.delete('/api/admin/inscricao/:numero', exigirAdmin, async (req, res) => {
  try {
    const { numero } = req.params;
    const row = await consultarUm(
      'SELECT contrato_path FROM inscricoes WHERE numero_cadastro = ?',
      [numero]
    );

    if (!row) return res.status(404).json({ ok: false, erro: 'Não encontrado.' });

    // Remove arquivo de contrato
    if (row.contrato_path && fs.existsSync(row.contrato_path)) {
      fs.unlinkSync(row.contrato_path);
    }

    await executar('DELETE FROM inscricoes WHERE numero_cadastro = ?', [numero]);
    return res.json({ ok: true });
  } catch (err) {
    console.error('Erro admin delete:', err);
    return res.status(500).json({ ok: false, erro: 'Erro ao remover.' });
  }
});

inicializarBanco()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Servidor Elite Combat rodando em http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Erro ao inicializar o banco de dados:', err);
    process.exit(1);
});