const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const app = express();
const PORT = 3000;

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

// ================== APP ==================
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---- Rota: gerar número de cadastro único de 11 dígitos ----
function gerarNumeroCadastro() {
  // 11 dígitos, primeiro não pode ser 0
  let n;
  let tentativas = 0;
  do {
    n = String(crypto.randomInt(10000000000, 99999999999));
    tentativas++;
  } while (db.prepare('SELECT 1 FROM inscricoes WHERE numero_cadastro = ?').get(n) && tentativas < 20);
  return n;
}

// ---- Rota: receber inscrição ----
app.post('/api/inscricao', (req, res) => {
  try {
    const b = req.body || {};

    // ---------- VALIDAÇÕES BÁSICAS ----------
    const obrig = ['nome', 'data_nascimento', 'telefone', 'turma', 'emerg_nome', 'emerg_telefone'];
    for (const campo of obrig) {
      if (!b[campo] || !String(b[campo]).trim()) {
        return res.status(400).json({ ok: false, erro: `Campo obrigatório: ${campo}` });
      }
    }

    // Telefone emergência ≠ telefone aluno
    const norm = (t) => String(t || '').replace(/\D/g, '');
    if (norm(b.telefone) === norm(b.emerg_telefone)) {
      return res.status(400).json({ ok: false, erro: 'O telefone de emergência não pode ser igual ao seu telefone.' });
    }

    // Idade
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

    // Responsável obrigatório se < 18
    const menor = idade < 18;
    if (menor) {
      if (!b.resp_nome || !b.resp_nome.trim()) {
        return res.status(400).json({ ok: false, erro: 'Responsável legal obrigatório para menores de 18 anos.' });
      }
      if (!b.resp_telefone || !b.resp_telefone.trim()) {
        return res.status(400).json({ ok: false, erro: 'Telefone do responsável obrigatório para menores de 18 anos.' });
      }
    }

    // Autorização de dados obrigatória
    if (b.autorizou_dados !== 'sim') {
      return res.status(400).json({ ok: false, erro: 'É necessário autorizar o uso das informações de saúde.' });
    }

    // ---------- DADOS INALTERÁVEIS ----------
    const numero_cadastro = gerarNumeroCadastro();
    const data_preenchimento = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const responsavel_atendimento = 'BDST';

    // ---------- INSERIR NO BANCO ----------
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
      resp_parentesco: menor ? (b.resp_parentesco || null) : null,
      resp_telefone: menor ? b.resp_telefone.trim() : null,
      emerg_nome: b.emerg_nome.trim(),
      emerg_parentesco: b.emerg_parentesco || null,
      emerg_telefone: b.emerg_telefone.trim(),
      saude_json: JSON.stringify(saude),
      adaptacoes: b.adaptacoes || null,
      autorizou_dados: b.autorizou_dados
    });

    const idInscricao = info.lastInsertRowid;

    // ---------- GERAR CONTRATO ----------
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
      saude
    });
    fs.writeFileSync(contratoPath, contratoConteudo, 'utf-8');

    // Grava caminho do contrato
    db.prepare('UPDATE inscricoes SET contrato_path = ? WHERE id = ?')
      .run(contratoPath, idInscricao);

    return res.json({
      ok: true,
      numero_cadastro,
      mensagem: 'Bem Vindo à Família Elite',
      contrato_arquivo: `contrato_${numero_cadastro}.txt`
    });
  } catch (err) {
    console.error('Erro na inscrição:', err);
    return res.status(500).json({ ok: false, erro: 'Erro interno ao processar inscrição.' });
  }
});

// ---- Rota: baixar contrato ----
app.get('/api/contrato/:numero', (req, res) => {
  const { numero } = req.params;
  const row = db.prepare('SELECT contrato_path FROM inscricoes WHERE numero_cadastro = ?').get(numero);
  if (!row || !row.contrato_path || !fs.existsSync(row.contrato_path)) {
    return res.status(404).send('Contrato não encontrado.');
  }
  res.download(row.contrato_path, `contrato_${numero}.txt`);
});

// ---- Geração do contrato em texto ----
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
    q8: 'Orientação médica para restringir exercícios'
  };
  Object.keys(mapa).forEach(k => {
    const v = (s[k] === 'sim') ? 'SIM' : 'NÃO';
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
  linhas.push(`Assinatura .....: ${d.nome}${d.resp_nome ? ' (responsável: ' + d.resp_nome + ')' : ''}`);
  linhas.push('');
  linhas.push('================================================================');
  linhas.push('   DOCUMENTO GERADO ELETRONICAMENTE — ELITE COMBAT');
  linhas.push('================================================================');
  return linhas.join('\n');
}

// ================== START ==================
app.listen(PORT, () => {
  console.log(`Servidor Elite Combat rodando em http://localhost:${PORT}`);
});