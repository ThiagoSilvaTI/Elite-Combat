const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { promisify } = require('util');
const Database = require('better-sqlite3');
const scrypt = promisify(crypto.scrypt);

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
    turma_aula    TEXT,
    periodo       TEXT,
    horario       TEXT,
    ja_muaythai   TEXT,
    ja_outra_arte TEXT,
    modalidade    TEXT,
    tempo_pratica TEXT,
    objetivo      TEXT,
    tipo_inscricao TEXT NOT NULL DEFAULT 'aluno',
    autorizacao_instrutor INTEGER NOT NULL DEFAULT 0,
    senha_salt   TEXT,
    senha_hash   TEXT,
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

const colunasInscricao = new Set(
  db.prepare('PRAGMA table_info(inscricoes)').all().map((coluna) => coluna.name)
);
if (!colunasInscricao.has('tipo_inscricao')) {
  db.exec("ALTER TABLE inscricoes ADD COLUMN tipo_inscricao TEXT NOT NULL DEFAULT 'aluno'");
}
if (!colunasInscricao.has('autorizacao_instrutor')) {
  db.exec('ALTER TABLE inscricoes ADD COLUMN autorizacao_instrutor INTEGER NOT NULL DEFAULT 0');
}
if (!colunasInscricao.has('turma_aula')) {
  db.exec('ALTER TABLE inscricoes ADD COLUMN turma_aula TEXT');
}
if (!colunasInscricao.has('senha_salt')) {
  db.exec('ALTER TABLE inscricoes ADD COLUMN senha_salt TEXT');
}
if (!colunasInscricao.has('senha_hash')) {
  db.exec('ALTER TABLE inscricoes ADD COLUMN senha_hash TEXT');
}

db.exec(`
  CREATE TABLE IF NOT EXISTS feedbacks (
    numero_cadastro TEXT PRIMARY KEY,
    nota INTEGER NOT NULL CHECK (nota BETWEEN 1 AND 5),
    recomendacao TEXT NOT NULL,
    criado_em TEXT NOT NULL DEFAULT (datetime('now')),
    atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

function normalizarTelefone(valor) {
  const digits = String(valor || '').replace(/\D/g, '');
  return digits.startsWith('55') && (digits.length === 12 || digits.length === 13)
    ? digits.slice(2)
    : digits;
}

function calcularIdade(dataNascimento) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dataNascimento || ''))) return null;
  const nascimento = new Date(`${dataNascimento}T00:00:00Z`);
  if (Number.isNaN(nascimento.getTime()) || nascimento.toISOString().slice(0, 10) !== dataNascimento) {
    return null;
  }
  const hoje = new Date();
  let idade = hoje.getUTCFullYear() - nascimento.getUTCFullYear();
  if (
    hoje.getUTCMonth() < nascimento.getUTCMonth() ||
    (hoje.getUTCMonth() === nascimento.getUTCMonth() &&
      hoje.getUTCDate() < nascimento.getUTCDate())
  ) {
    idade--;
  }
  return idade;
}

function turmaPorIdade(idade) {
  return idade < 7 ? 'Baby Thai (4 a 6 anos)' :
    idade < 14 ? 'Kids (7 a 13 anos)' : 'Juvenil / Adulto (14+)';
}

function montarDadosContrato(row, saude = null) {
  const dadosSaude = saude || (row.saude_json ? JSON.parse(row.saude_json) : {});
  return {
    ...row,
    saude: dadosSaude,
    adaptacoes: row.adaptacoes || 'Nenhuma informada',
    emerg_nome: row.emerg_nome || 'Não informado',
    emerg_telefone: row.emerg_telefone || 'Não informado',
    periodo: row.periodo || 'A definir',
    horario: row.horario || 'A definir',
    turma_aula: row.turma_aula || 'A definir',
  };
}

const tentativasAcessoFicha = new Map();
function limitarAcessoFicha(req, res, next) {
  const agora = Date.now();
  res.setHeader('Cache-Control', 'no-store');
  const ip = req.socket.remoteAddress || 'unknown';
  const identificador = String(
    req.body?.numero_cadastro || normalizarTelefone(req.body?.telefone) || 'sem-identificador'
  );
  const chaves = [
    { chave: `${ip}:${req.path}`, limite: 100 },
    { chave: `${ip}:${req.path}:${identificador}`, limite: 10 },
  ];
  const janela = 15 * 60 * 1000;
  for (const { chave, limite } of chaves) {
    const atual = tentativasAcessoFicha.get(chave);
    if (atual && agora - atual.inicio < janela && atual.quantidade >= limite) {
      res.setHeader('Retry-After', String(Math.ceil((janela - (agora - atual.inicio)) / 1000)));
      return res.status(429).json({
        ok: false,
        erro: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.',
      });
    }
  }
  for (const { chave } of chaves) {
    const atual = tentativasAcessoFicha.get(chave);
    if (!atual || agora - atual.inicio >= janela) {
      tentativasAcessoFicha.set(chave, { inicio: agora, quantidade: 1 });
    } else {
      atual.quantidade++;
    }
  }
  if (tentativasAcessoFicha.size > 10000) {
    for (const [ip, tentativa] of tentativasAcessoFicha) {
      if (agora - tentativa.inicio >= janela) tentativasAcessoFicha.delete(ip);
    }
  }
  return next();
}

async function criarHashSenha(senha) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(senha, salt, 64);
  return { salt: salt.toString('hex'), hash: hash.toString('hex') };
}

async function validarSenha(senha, saltHex, hashHex) {
  if (!saltHex || !hashHex) return false;
  const esperado = Buffer.from(hashHex, 'hex');
  const recebido = await scrypt(senha, Buffer.from(saltHex, 'hex'), esperado.length);
  return esperado.length === recebido.length && crypto.timingSafeEqual(esperado, recebido);
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

app.get('/api/feedback', (req, res) => {
  try {
    const feedbacks = db.prepare(`
      SELECT i.nome, f.nota, f.recomendacao, f.atualizado_em
      FROM feedbacks f
      JOIN inscricoes i ON i.numero_cadastro = f.numero_cadastro
      ORDER BY f.atualizado_em DESC
      LIMIT 50
    `).all();
    return res.json({ ok: true, feedbacks });
  } catch (err) {
    console.error('Erro ao listar feedbacks:', err);
    return res.status(500).json({ ok: false, erro: 'Não foi possível carregar os feedbacks.' });
  }
});

app.post('/api/feedback', (req, res) => {
  try {
    const numero = String(req.body?.numero_cadastro || '').trim();
    const telefone = String(req.body?.telefone || '').trim();
    const recomendacao = String(req.body?.recomendacao || '').trim();
    const nota = Number(req.body?.nota);
    const consentimento = req.body?.consentimento === true;

    if (!/^\d{11}$/.test(numero) || !/^[\d\s()+-]{10,20}$/.test(telefone)) {
      return res.status(400).json({
        ok: false,
        erro: 'Informe um número de cadastro válido e o telefone usado na inscrição.',
      });
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
        erro: 'Autorize a publicação da sua avaliação junto ao nome da ficha.',
      });
    }

    const inscricao = db.prepare(
      'SELECT nome, telefone FROM inscricoes WHERE numero_cadastro = ?'
    ).get(numero);
    if (!inscricao || normalizarTelefone(inscricao.telefone) !== normalizarTelefone(telefone)) {
      return res.status(404).json({
        ok: false,
        erro: 'Não encontramos uma inscrição com esses dados. Confira o número de cadastro e o telefone.',
      });
    }

    db.prepare(`
      INSERT INTO feedbacks (numero_cadastro, nota, recomendacao)
      VALUES (?, ?, ?)
      ON CONFLICT(numero_cadastro) DO UPDATE SET
        nota = excluded.nota,
        recomendacao = excluded.recomendacao,
        atualizado_em = datetime('now')
    `).run(numero, nota, recomendacao);

    return res.json({
      ok: true,
      mensagem: 'Obrigado por compartilhar sua avaliação!',
      nome: inscricao.nome,
    });
  } catch (err) {
    console.error('Erro ao salvar feedback:', err);
    return res.status(500).json({ ok: false, erro: 'Não foi possível enviar o feedback.' });
  }
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

    const obrig = ['nome', 'data_nascimento', 'telefone'];
    for (const campo of obrig) {
      if (!b[campo] || !String(b[campo]).trim()) {
        return res.status(400).json({ ok: false, erro: `Campo obrigatório: ${campo}` });
      }
    }

    const idade = calcularIdade(String(b.data_nascimento || ''));
    if (idade === null) {
      return res.status(400).json({ ok: false, erro: 'Data de nascimento inválida.' });
    }
    if (idade < 4) {
      return res.status(400).json({ ok: false, erro: 'A idade mínima para inscrição é 4 anos.' });
    }
    if (idade > 120) {
      return res.status(400).json({ ok: false, erro: 'Idade fora do intervalo permitido.' });
    }

    const turma = turmaPorIdade(idade);
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

    const numero_cadastro = gerarNumeroCadastro();
    const data_preenchimento = new Date().toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
    });
    const responsavel_atendimento = 'BDST';

    const stmt = db.prepare(`
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
  if (!credenciaisAdminValidas(req)) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Elite Combat Admin"');
    return res.status(401).send('Acesse sua ficha para consultar o contrato.');
  }
  const row = db
    .prepare('SELECT contrato_path FROM inscricoes WHERE numero_cadastro = ?')
    .get(numero);
  if (!row || !row.contrato_path || !fs.existsSync(row.contrato_path)) {
    return res.status(404).send('Contrato não encontrado.');
  }
  res.download(row.contrato_path, `contrato_${numero}.txt`);
});

// ---- Rota: consultar inscrição pelo app autenticado ----
app.get('/api/integracao/inscricao', (req, res) => {
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

  const row = db
    .prepare('SELECT * FROM inscricoes WHERE numero_cadastro = ?')
    .get(numero);

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
      contrato_disponivel: !!(row.contrato_path && fs.existsSync(row.contrato_path)),
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
    linhas.push(`Já praticou Muay Thai ..: ${d.ja_muaythai || 'Não informado'}`);
    linhas.push(`Praticou outra arte .....: ${d.ja_outra_arte || 'Não informado'}`);
    linhas.push(`Modalidade ..............: ${d.modalidade || 'Não informado'}`);
    linhas.push(`Tempo de prática ........: ${d.tempo_pratica || 'Não informado'}`);
    linhas.push(`Objetivo ................: ${d.objetivo || 'Não informado'}`);
  }
  if (d.resp_nome) {
    linhas.push('');
    linhas.push('--------- RESPONSÁVEL LEGAL (menor de 18) -------');
    linhas.push(`Nome ....................: ${d.resp_nome}`);
    linhas.push(`Parentesco ..............: ${d.resp_parentesco || 'Não informado'}`);
    linhas.push(`Telefone ................: ${d.resp_telefone}`);
  }
  linhas.push('');
  linhas.push('--------- CONTATO DE EMERGÊNCIA ---------');
  linhas.push(`Nome ....................: ${d.emerg_nome}`);
  linhas.push(`Parentesco ..............: ${d.emerg_parentesco || 'Não informado'}`);
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

function dadosPublicosFicha(row) {
  let saude = {};
  try {
    saude = row.saude_json ? JSON.parse(row.saude_json) : {};
  } catch (err) {
    console.error('Erro ao ler dados de saúde da ficha:', err);
    throw new Error('Não foi possível ler os dados da ficha.');
  }
  const {
    senha_salt,
    senha_hash,
    contrato_path,
    ...dados
  } = row;
  return {
    ...dados,
    saude,
    autorizacao_instrutor: !!row.autorizacao_instrutor,
    contrato_disponivel: !!(contrato_path && fs.existsSync(contrato_path)),
  };
}

function validarSaudeFicha(saude) {
  if (!saude || typeof saude !== 'object' || Array.isArray(saude)) return null;
  const resultado = {};
  for (let i = 1; i <= 8; i++) {
    const chave = `q${i}`;
    if (!['sim', 'nao'].includes(saude[chave])) return null;
    resultado[chave] = saude[chave];
    if (saude[chave] === 'sim') {
      const detalhe = String(saude[`${chave}_detalhe`] || '').trim();
      if (!detalhe || detalhe.length > 1000) return null;
      resultado[`${chave}_detalhe`] = detalhe;
    }
  }
  return resultado;
}

function textoFicha(valor, maximo = 200) {
  const texto = String(valor || '').trim();
  return texto.length <= maximo ? texto : null;
}

app.post('/api/ficha/recuperar-cadastro', limitarAcessoFicha, (req, res) => {
  const telefone = String(req.body?.telefone || '').trim();
  const nascimento = String(req.body?.data_nascimento || '').trim();
  if (!/^[\d\s()+-]{10,20}$/.test(telefone) || calcularIdade(nascimento) === null) {
    return res.status(400).json({ ok: false, erro: 'Informe telefone e data de nascimento válidos.' });
  }
  const candidatos = db.prepare(
    'SELECT numero_cadastro, nome, telefone FROM inscricoes WHERE data_nascimento = ?'
  ).all(nascimento).filter((row) =>
    normalizarTelefone(row.telefone) === normalizarTelefone(telefone)
  );
  if (!candidatos.length) {
    return res.status(404).json({
      ok: false,
      erro: 'Não encontramos uma ficha com esses dados. Confira as informações ou fale com a academia.',
    });
  }
  return res.json({
    ok: true,
    fichas: candidatos.map(({ numero_cadastro, nome }) => ({ numero_cadastro, nome })),
  });
});

app.post('/api/ficha/definir-senha', limitarAcessoFicha, async (req, res) => {
  try {
    const numero = String(req.body?.numero_cadastro || '').trim();
    const telefone = String(req.body?.telefone || '').trim();
    const nascimento = String(req.body?.data_nascimento || '').trim();
    const senha = String(req.body?.senha || '');
    if (!/^\d{11}$/.test(numero) || !/^[\d\s()+-]{10,20}$/.test(telefone) ||
        calcularIdade(nascimento) === null || !/^\d{6,64}$/.test(senha)) {
      return res.status(400).json({
        ok: false,
        erro: 'Confira o cadastro, telefone, data de nascimento e senha (mínimo de 6 dígitos).',
      });
    }
    const row = db.prepare(
      'SELECT numero_cadastro, telefone, data_nascimento FROM inscricoes WHERE numero_cadastro = ?'
    ).get(numero);
    if (!row || row.data_nascimento !== nascimento ||
        normalizarTelefone(row.telefone) !== normalizarTelefone(telefone)) {
      return res.status(404).json({
        ok: false,
        erro: 'Não encontramos uma ficha com esses dados. Confira as informações.',
      });
    }
    const credencial = await criarHashSenha(senha);
    db.prepare('UPDATE inscricoes SET senha_salt = ?, senha_hash = ? WHERE numero_cadastro = ?')
      .run(credencial.salt, credencial.hash, numero);
    return res.json({ ok: true, mensagem: 'Senha cadastrada. Agora você já pode entrar na sua ficha.' });
  } catch (err) {
    console.error('Erro ao definir senha da ficha:', err);
    return res.status(500).json({ ok: false, erro: 'Não foi possível cadastrar a senha.' });
  }
});

app.post('/api/ficha/entrar', limitarAcessoFicha, async (req, res) => {
  try {
    const numero = String(req.body?.numero_cadastro || '').trim();
    const senha = String(req.body?.senha || '');
    if (!/^\d{11}$/.test(numero) || !/^\d{6,64}$/.test(senha)) {
      return res.status(401).json({ ok: false, erro: 'Cadastro ou senha incorretos.' });
    }
    const row = db.prepare('SELECT * FROM inscricoes WHERE numero_cadastro = ?').get(numero);
    if (!row || !(await validarSenha(senha, row.senha_salt, row.senha_hash))) {
      return res.status(401).json({ ok: false, erro: 'Cadastro ou senha incorretos.' });
    }
    return res.json({ ok: true, ficha: dadosPublicosFicha(row) });
  } catch (err) {
    console.error('Erro ao entrar na ficha:', err);
    return res.status(500).json({ ok: false, erro: 'Não foi possível carregar sua ficha.' });
  }
});

app.post('/api/ficha/contrato', limitarAcessoFicha, async (req, res) => {
  try {
    const numero = String(req.body?.numero_cadastro || '').trim();
    const senha = String(req.body?.senha || '');
    if (!/^\d{11}$/.test(numero) || !/^\d{6,64}$/.test(senha)) {
      return res.status(401).json({ ok: false, erro: 'Cadastro ou senha incorretos.' });
    }
    const row = db.prepare('SELECT * FROM inscricoes WHERE numero_cadastro = ?').get(numero);
    if (!row || !(await validarSenha(senha, row.senha_salt, row.senha_hash))) {
      return res.status(401).json({ ok: false, erro: 'Cadastro ou senha incorretos.' });
    }
    if (!row.contrato_path || !fs.existsSync(row.contrato_path)) {
      return res.status(404).json({ ok: false, erro: 'Contrato não encontrado.' });
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.download(row.contrato_path, `contrato_${numero}.txt`, (err) => {
      if (err && !res.headersSent) {
        console.error('Erro ao baixar contrato:', err);
        res.status(500).json({ ok: false, erro: 'Não foi possível baixar o contrato.' });
      }
    });
  } catch (err) {
    console.error('Erro ao validar acesso ao contrato:', err);
    return res.status(500).json({ ok: false, erro: 'Não foi possível baixar o contrato.' });
  }
});

app.put('/api/ficha/senha', limitarAcessoFicha, async (req, res) => {
  try {
    const numero = String(req.body?.numero_cadastro || '').trim();
    const senhaAtual = String(req.body?.senha_atual || '');
    const novaSenha = String(req.body?.nova_senha || '');
    if (!/^\d{11}$/.test(numero) || !/^\d{6,64}$/.test(senhaAtual) ||
        !/^\d{6,64}$/.test(novaSenha)) {
      return res.status(400).json({ ok: false, erro: 'A senha deve conter pelo menos 6 dígitos.' });
    }
    const row = db.prepare(
      'SELECT senha_salt, senha_hash FROM inscricoes WHERE numero_cadastro = ?'
    ).get(numero);
    if (!row || !(await validarSenha(senhaAtual, row.senha_salt, row.senha_hash))) {
      return res.status(401).json({ ok: false, erro: 'Senha atual incorreta.' });
    }
    const credencial = await criarHashSenha(novaSenha);
    db.prepare('UPDATE inscricoes SET senha_salt = ?, senha_hash = ? WHERE numero_cadastro = ?')
      .run(credencial.salt, credencial.hash, numero);
    return res.json({ ok: true, mensagem: 'Senha alterada com sucesso.' });
  } catch (err) {
    console.error('Erro ao alterar senha da ficha:', err);
    return res.status(500).json({ ok: false, erro: 'Não foi possível alterar a senha.' });
  }
});

app.put('/api/ficha', limitarAcessoFicha, async (req, res) => {
  let arquivoTemporario;
  try {
    const numero = String(req.body?.numero_cadastro || '').trim();
    const senha = String(req.body?.senha || '');
    if (!/^\d{11}$/.test(numero) || !/^\d{6,64}$/.test(senha)) {
      return res.status(401).json({ ok: false, erro: 'Cadastro ou senha incorretos.' });
    }
    const atual = db.prepare('SELECT * FROM inscricoes WHERE numero_cadastro = ?').get(numero);
    if (!atual || !(await validarSenha(senha, atual.senha_salt, atual.senha_hash))) {
      return res.status(401).json({ ok: false, erro: 'Cadastro ou senha incorretos.' });
    }

    const b = req.body || {};
    const nome = textoFicha(b.nome, 150);
    const idade = calcularIdade(String(b.data_nascimento || ''));
    const tipo = String(b.tipo_inscricao || '');
    const saude = validarSaudeFicha(b.saude);
    const adaptacoes = textoFicha(b.adaptacoes, 2000);
    if (!nome || nome.length < 2 || idade === null || idade < 4 || idade > 120 ||
        !['aluno', 'instrutor'].includes(tipo) || !saude || adaptacoes === null) {
      return res.status(400).json({
        ok: false,
        erro: 'Confira nome, data de nascimento, tipo de inscrição e informações de saúde.',
      });
    }

    const menor = idade < 18;
    const respNome = menor ? textoFicha(b.resp_nome, 150) : null;
    const respParentesco = menor ? textoFicha(b.resp_parentesco, 100) : null;
    const respTelefone = menor ? textoFicha(b.resp_telefone, 30) : null;
    const emergNome = menor ? textoFicha(b.emerg_nome, 150) : '';
    const emergParentesco = menor ? textoFicha(b.emerg_parentesco, 100) : null;
    const emergTelefone = menor ? textoFicha(b.emerg_telefone, 30) : '';
    if (menor && (!respNome || !respTelefone || !emergNome || !emergTelefone)) {
      return res.status(400).json({
        ok: false,
        erro: 'Responsável e contato de emergência são obrigatórios para menores de 18 anos.',
      });
    }
    if (menor && normalizarTelefone(emergTelefone) === normalizarTelefone(atual.telefone)) {
      return res.status(400).json({
        ok: false,
        erro: 'O telefone de emergência não pode ser igual ao telefone do aluno.',
      });
    }

    const autorizacaoInstrutor = tipo === 'instrutor' &&
      (Boolean(atual.autorizacao_instrutor) ||
        (atual.tipo_inscricao !== 'instrutor' && b.autorizacao_instrutor === true));
    if (tipo === 'instrutor' && !autorizacaoInstrutor) {
      return res.status(400).json({
        ok: false,
        erro: 'Confirme a autorização do professor para a inscrição como Instrutor Elite.',
      });
    }
    let turmaAula = atual.turma_aula;
    let periodo = atual.periodo;
    let horario = atual.horario;
    if (tipo === 'instrutor') {
      const periodosValidos = ['Manhã', 'Tarde', 'Noite', 'A definir'];
      const turmasValidas = ['Baby Thai', 'Kids', 'Juvenil / Adulto', 'A definir'];
      turmaAula = String(b.turma_aula || '');
      periodo = String(b.periodo || '');
      horario = textoFicha(b.horario, 100);
      if (!turmasValidas.includes(turmaAula) || !periodosValidos.includes(periodo) || !horario) {
        return res.status(400).json({
          ok: false,
          erro: 'Informe a turma de aula, o horário de treino e o horário da aula.',
        });
      }
    }

    const atualizado = {
      ...atual,
      nome,
      data_nascimento: b.data_nascimento,
      idade,
      turma: turmaPorIdade(idade),
      tipo_inscricao: tipo,
      autorizacao_instrutor: autorizacaoInstrutor ? 1 : 0,
      turma_aula: tipo === 'instrutor' ? turmaAula : null,
      periodo: tipo === 'instrutor' ? periodo : atual.periodo,
      horario: tipo === 'instrutor' ? horario : atual.horario,
      resp_nome: respNome,
      resp_parentesco: respParentesco,
      resp_telefone: respTelefone,
      emerg_nome: emergNome,
      emerg_parentesco: emergParentesco,
      emerg_telefone: emergTelefone,
      saude_json: JSON.stringify(saude),
      adaptacoes,
    };
    const contratoPath = path.join(CONTRATOS_DIR, `contrato_${numero}.txt`);
    arquivoTemporario = `${contratoPath}.tmp-${crypto.randomBytes(8).toString('hex')}`;
    fs.writeFileSync(arquivoTemporario, gerarContrato(montarDadosContrato(atualizado, saude)), 'utf-8');
    const atualizarFicha = db.transaction(() => {
      db.prepare(`
        UPDATE inscricoes SET
          nome = @nome, data_nascimento = @data_nascimento, idade = @idade, turma = @turma,
          tipo_inscricao = @tipo_inscricao, autorizacao_instrutor = @autorizacao_instrutor,
          turma_aula = @turma_aula, periodo = @periodo, horario = @horario,
          resp_nome = @resp_nome, resp_parentesco = @resp_parentesco, resp_telefone = @resp_telefone,
          emerg_nome = @emerg_nome, emerg_parentesco = @emerg_parentesco, emerg_telefone = @emerg_telefone,
          saude_json = @saude_json, adaptacoes = @adaptacoes, contrato_path = @contrato_path
        WHERE numero_cadastro = @numero_cadastro
      `).run({ ...atualizado, contrato_path: contratoPath, numero_cadastro: numero });
      fs.renameSync(arquivoTemporario, contratoPath);
      arquivoTemporario = null;
    });
    atualizarFicha();
    const fichaAtualizada = db.prepare('SELECT * FROM inscricoes WHERE numero_cadastro = ?').get(numero);
    return res.json({
      ok: true,
      mensagem: 'Sua ficha e seu contrato foram atualizados.',
      ficha: dadosPublicosFicha(fichaAtualizada),
    });
  } catch (err) {
    if (arquivoTemporario && fs.existsSync(arquivoTemporario)) {
      fs.unlinkSync(arquivoTemporario);
    }
    console.error('Erro ao atualizar ficha:', err);
    return res.status(500).json({ ok: false, erro: 'Não foi possível atualizar sua ficha.' });
  }
});

// ================== ADMIN ==================
const ADMIN_USER = 'MuayThai';
const ADMIN_PASS = 'NakMuay';

function credenciaisAdminValidas(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Basic ')) return false;
  const [user, pass] = Buffer.from(auth.split(' ')[1], 'base64').toString().split(':');
  return user === ADMIN_USER && pass === ADMIN_PASS;
}

// Middleware de autenticação básica
function exigirAdmin(req, res, next) {
  if (!credenciaisAdminValidas(req)) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Elite Combat Admin"');
    return res.status(401).send('Autenticação necessária ou usuário/senha inválidos.');
  }
  return next();
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
                turma, tipo_inscricao, autorizacao_instrutor, turma_aula, periodo, horario, objetivo,
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
        turma, turma_aula, periodo, horario, ja_muaythai, ja_outra_arte, modalidade, tempo_pratica, objetivo,
        tipo_inscricao, autorizacao_instrutor,
        resp_nome, resp_parentesco, resp_telefone,
        emerg_nome, emerg_parentesco, emerg_telefone,
        saude_json, adaptacoes, autorizou_dados,
        contrato_path, criado_em
      ) VALUES (
        @numero_cadastro, @data_preenchimento, @responsavel_atendimento,
        @nome, @data_nascimento, @idade, @telefone,
        @turma, @turma_aula, @periodo, @horario, @ja_muaythai, @ja_outra_arte, @modalidade, @tempo_pratica, @objetivo,
        @tipo_inscricao, @autorizacao_instrutor,
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