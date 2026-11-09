(() => {
    const questions = [
        ['q1', 'Possui alguma condição médica que exige cuidado durante exercícios?'],
        ['q2', 'Possui alguma condição psicológica ou de neurodesenvolvimento importante para o treino?'],
        ['q3', 'Possui alguma deficiência ou limitação física?'],
        ['q4', 'Tem histórico de lesão, cirurgia ou fratura?'],
        ['q5', 'Usa algum medicamento continuamente?'],
        ['q6', 'Tem alguma alergia relevante?'],
        ['q7', 'Já teve desmaio, dor no peito ou falta de ar durante esforço?'],
        ['q8', 'Recebeu orientação médica para restringir exercícios físicos?'],
    ];
    const message = document.getElementById('accountMessage');
    const loginPanel = document.getElementById('loginPanel');
    const setupPanel = document.getElementById('setupPanel');
    const recoverPanel = document.getElementById('recoverPanel');
    const profilePanel = document.getElementById('profilePanel');
    const loginForm = document.getElementById('loginForm');
    const setupForm = document.getElementById('setupForm');
    const recoverForm = document.getElementById('recoverForm');
    const passwordForm = document.getElementById('passwordForm');
    const editForm = document.getElementById('editForm');
    const loginNumber = document.getElementById('loginNumber');
    const setupNumber = document.getElementById('setupNumber');
    const foundNumbers = document.getElementById('foundNumbers');
    let fichaAtual = null;
    let senhaAtual = '';

    questions.forEach(([key, title]) => {
        const row = document.createElement('div');
        row.className = 'account-health-item';
        const label = document.createElement('label');
        label.htmlFor = `health_${key}`;
        label.textContent = title;
        const field = document.createElement('select');
        field.id = `health_${key}`;
        field.name = key;
        field.required = true;
        field.innerHTML = '<option value="">Selecione</option><option value="nao">Não</option><option value="sim">Sim</option>';
        const detail = document.createElement('div');
        detail.className = 'account-field account-hidden';
        const detailLabel = document.createElement('label');
        detailLabel.htmlFor = `health_${key}_detalhe`;
        detailLabel.textContent = 'Explique brevemente';
        const detailInput = document.createElement('input');
        detailInput.id = `health_${key}_detalhe`;
        detailInput.name = `${key}_detalhe`;
        detailInput.maxLength = 1000;
        detailInput.type = 'text';
        detailInput.required = false;
        detail.append(detailLabel, detailInput);
        field.addEventListener('change', () => {
            const visible = field.value === 'sim';
            detail.classList.toggle('account-hidden', !visible);
            detailInput.required = visible;
            if (!visible) detailInput.value = '';
        });
        row.append(label, field, detail);
        document.getElementById('healthFields').appendChild(row);
    });

    function showMessage(text, success = false) {
        message.textContent = text;
        message.classList.toggle('success', success);
    }

    async function request(url, options) {
        const response = await fetch(url, {
            ...options,
            headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
        });
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.erro || 'Não foi possível concluir a solicitação.');
        return data;
    }

    function setBusy(form, busy) {
        form.querySelectorAll('button[type="submit"]').forEach((button) => {
            button.disabled = busy;
        });
    }

    function formatarSaude(saude) {
        return questions.map(([key, title]) => ({
            label: title,
            value: saude?.[key] === 'sim'
                ? `Sim — ${saude[`${key}_detalhe`] || 'sem detalhes'}`
                : 'Não',
        }));
    }

    function addContractRows(rows) {
        const list = document.getElementById('contractDetails');
        list.replaceChildren();
        rows.forEach(([label, value]) => {
            const item = document.createElement('div');
            const title = document.createElement('dt');
            const detail = document.createElement('dd');
            title.textContent = label;
            detail.textContent = value == null || value === '' ? 'Não informado' : String(value);
            item.append(title, detail);
            list.appendChild(item);
        });
    }

    function renderContract(ficha) {
        addContractRows([
            ['Cadastro', ficha.numero_cadastro],
            ['Nome', ficha.nome],
            ['Data de nascimento', ficha.data_nascimento],
            ['Idade', `${ficha.idade} anos`],
            ['Telefone', ficha.telefone],
            ['Turma', ficha.turma],
            ['Inscrição', ficha.tipo_inscricao === 'instrutor' ? 'Instrutor Elite' : 'Aluno'],
            ['Autorização do professor', ficha.tipo_inscricao === 'instrutor' && ficha.autorizacao_instrutor ? 'Confirmada' : 'Não se aplica'],
            ['Turma de aula', ficha.turma_aula],
            ['Horário de treino', ficha.periodo],
            ['Horário da aula', ficha.horario],
            ['Já praticou Muay Thai', ficha.ja_muaythai],
            ['Praticou outra arte marcial', ficha.ja_outra_arte],
            ['Modalidade praticada', ficha.modalidade],
            ['Tempo de prática', ficha.tempo_pratica],
            ['Objetivo', ficha.objetivo],
            ['Responsável legal', ficha.resp_nome],
            ['Parentesco do responsável', ficha.resp_parentesco],
            ['Telefone do responsável', ficha.resp_telefone],
            ['Contato de emergência', ficha.emerg_nome],
            ['Parentesco do contato', ficha.emerg_parentesco],
            ['Telefone de emergência', ficha.emerg_telefone],
            ...formatarSaude(ficha.saude).map((item) => [item.label, item.value]),
            ['Adaptações e observações', ficha.adaptacoes],
            ['Data de inscrição', ficha.data_preenchimento],
            ['Atendimento', ficha.responsavel_atendimento],
        ]);
    }

    function idadeNaData(data) {
        if (!data) return null;
        const nascimento = new Date(`${data}T00:00:00`);
        if (Number.isNaN(nascimento.getTime())) return null;
        const hoje = new Date();
        let idade = hoje.getFullYear() - nascimento.getFullYear();
        if (hoje.getMonth() < nascimento.getMonth() ||
            (hoje.getMonth() === nascimento.getMonth() && hoje.getDate() < nascimento.getDate())) idade--;
        return idade;
    }

    function atualizarCamposCondicionais() {
        const menor = idadeNaData(editForm.elements.data_nascimento.value) < 18;
        document.getElementById('guardianFields').hidden = !menor;
        ['resp_nome', 'resp_telefone', 'emerg_nome', 'emerg_telefone'].forEach((name) => {
            editForm.elements[name].required = menor;
        });
        const instrutor = editForm.elements.tipo_inscricao.value === 'instrutor';
        document.getElementById('instructorFields').hidden = !instrutor;
        document.getElementById('teacherAuthorization').hidden =
            !instrutor || fichaAtual?.tipo_inscricao === 'instrutor';
        editForm.elements.turma_aula.required = instrutor;
        editForm.elements.periodo.required = instrutor;
        editForm.elements.horario.required = instrutor;
    }

    function renderFicha(ficha) {
        fichaAtual = ficha;
        renderContract(ficha);
        editForm.elements.nome.value = ficha.nome || '';
        editForm.elements.data_nascimento.value = ficha.data_nascimento || '';
        editForm.elements.tipo_inscricao.value = ficha.tipo_inscricao || 'aluno';
        editForm.elements.turma_aula.value = ficha.turma_aula || '';
        editForm.elements.periodo.value = ficha.periodo || '';
        editForm.elements.horario.value = ficha.horario || '';
        editForm.elements.resp_nome.value = ficha.resp_nome || '';
        editForm.elements.resp_parentesco.value = ficha.resp_parentesco || '';
        editForm.elements.resp_telefone.value = ficha.resp_telefone || '';
        editForm.elements.emerg_nome.value = ficha.emerg_nome || '';
        editForm.elements.emerg_parentesco.value = ficha.emerg_parentesco || '';
        editForm.elements.emerg_telefone.value = ficha.emerg_telefone || '';
        editForm.elements.adaptacoes.value = ficha.adaptacoes || '';
        editForm.elements.autorizacao_instrutor.checked = ficha.autorizacao_instrutor;
        questions.forEach(([key]) => {
            const value = ficha.saude?.[key] || '';
            const select = editForm.elements[key];
            select.value = value;
            select.dispatchEvent(new Event('change'));
            editForm.elements[`${key}_detalhe`].value = ficha.saude?.[`${key}_detalhe`] || '';
        });
        atualizarCamposCondicionais();
        loginPanel.hidden = true;
        setupPanel.hidden = true;
        recoverPanel.hidden = true;
        profilePanel.hidden = false;
        showMessage('Ficha carregada. Seus dados de saúde são exibidos somente após autenticação.', true);
    }

    loginForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        setBusy(loginForm, true);
        try {
            const senha = loginForm.elements.senha.value;
            const data = await request('/api/ficha/entrar', {
                method: 'POST',
                body: JSON.stringify({
                    numero_cadastro: loginNumber.value.trim(),
                    senha,
                }),
            });
            senhaAtual = senha;
            renderFicha(data.ficha);
        } catch (error) {
            showMessage(error.message);
        } finally {
            setBusy(loginForm, false);
        }
    });

    document.getElementById('showSetup').addEventListener('click', () => {
        setupPanel.hidden = false;
        recoverPanel.hidden = true;
        setupNumber.value = loginNumber.value.trim();
        showMessage('Para criar ou redefinir a senha, confirme o telefone e a data de nascimento da inscrição.');
    });

    document.getElementById('showRecover').addEventListener('click', () => {
        recoverPanel.hidden = false;
        setupPanel.hidden = true;
        showMessage('Informe o telefone e a data de nascimento usados na inscrição.');
    });

    recoverForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        setBusy(recoverForm, true);
        try {
            const data = await request('/api/ficha/recuperar-cadastro', {
                method: 'POST',
                body: JSON.stringify({
                    telefone: recoverForm.elements.telefone.value.trim(),
                    data_nascimento: recoverForm.elements.data_nascimento.value,
                }),
            });
            foundNumbers.replaceChildren();
            data.fichas.forEach((ficha) => {
                const option = document.createElement('option');
                option.value = ficha.numero_cadastro;
                option.textContent = `${ficha.nome} — ${ficha.numero_cadastro}`;
                foundNumbers.appendChild(option);
            });
            foundNumbers.hidden = data.fichas.length < 2;
            setupNumber.value = data.fichas[0].numero_cadastro;
            setupForm.elements.telefone.value = recoverForm.elements.telefone.value.trim();
            setupForm.elements.data_nascimento.value = recoverForm.elements.data_nascimento.value;
            setupPanel.hidden = false;
            showMessage(
                data.fichas.length === 1
                    ? `Cadastro encontrado para ${data.fichas[0].nome}. Defina sua senha para acessar a ficha.`
                    : 'Encontramos mais de uma ficha. Selecione a correta e defina sua senha.',
                true
            );
        } catch (error) {
            showMessage(error.message);
        } finally {
            setBusy(recoverForm, false);
        }
    });

    foundNumbers.addEventListener('change', () => {
        setupNumber.value = foundNumbers.value;
    });

    setupForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (setupForm.elements.senha.value !== setupForm.elements.confirmar_senha.value) {
            showMessage('As senhas não conferem.');
            return;
        }
        setBusy(setupForm, true);
        try {
            await request('/api/ficha/definir-senha', {
                method: 'POST',
                body: JSON.stringify({
                    numero_cadastro: setupNumber.value.trim(),
                    telefone: setupForm.elements.telefone.value.trim(),
                    data_nascimento: setupForm.elements.data_nascimento.value,
                    senha: setupForm.elements.senha.value,
                }),
            });
            loginNumber.value = setupNumber.value;
            loginForm.elements.senha.value = '';
            setupForm.reset();
            setupPanel.hidden = true;
            showMessage('Senha cadastrada. Entre com seu cadastro e a nova senha.', true);
        } catch (error) {
            showMessage(error.message);
        } finally {
            setBusy(setupForm, false);
        }
    });

    editForm.elements.data_nascimento.addEventListener('change', atualizarCamposCondicionais);
    editForm.elements.tipo_inscricao.addEventListener('change', atualizarCamposCondicionais);
    editForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        setBusy(editForm, true);
        const saude = {};
        questions.forEach(([key]) => {
            saude[key] = editForm.elements[key].value;
            if (saude[key] === 'sim') saude[`${key}_detalhe`] = editForm.elements[`${key}_detalhe`].value.trim();
        });
        try {
            const data = await request('/api/ficha', {
                method: 'PUT',
                body: JSON.stringify({
                    numero_cadastro: fichaAtual.numero_cadastro,
                    senha: senhaAtual,
                    nome: editForm.elements.nome.value.trim(),
                    data_nascimento: editForm.elements.data_nascimento.value,
                    tipo_inscricao: editForm.elements.tipo_inscricao.value,
                    autorizacao_instrutor: editForm.elements.autorizacao_instrutor.checked,
                    turma_aula: editForm.elements.turma_aula.value,
                    periodo: editForm.elements.periodo.value,
                    horario: editForm.elements.horario.value.trim(),
                    resp_nome: editForm.elements.resp_nome.value.trim(),
                    resp_parentesco: editForm.elements.resp_parentesco.value.trim(),
                    resp_telefone: editForm.elements.resp_telefone.value.trim(),
                    emerg_nome: editForm.elements.emerg_nome.value.trim(),
                    emerg_parentesco: editForm.elements.emerg_parentesco.value.trim(),
                    emerg_telefone: editForm.elements.emerg_telefone.value.trim(),
                    saude,
                    adaptacoes: editForm.elements.adaptacoes.value.trim(),
                }),
            });
            renderFicha(data.ficha);
            showMessage(data.mensagem, true);
        } catch (error) {
            showMessage(error.message);
        } finally {
            setBusy(editForm, false);
        }
    });

    document.getElementById('downloadContract').addEventListener('click', async () => {
        try {
            const response = await fetch('/api/ficha/contrato', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    numero_cadastro: fichaAtual.numero_cadastro,
                    senha: senhaAtual,
                }),
            });
            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.erro || 'Não foi possível baixar o contrato.');
            }
            const url = URL.createObjectURL(await response.blob());
            const link = document.createElement('a');
            link.href = url;
            link.download = `contrato_${fichaAtual.numero_cadastro}.txt`;
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (error) {
            showMessage(error.message);
        }
    });

    passwordForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (passwordForm.elements.nova_senha.value !== passwordForm.elements.confirmar_nova_senha.value) {
            showMessage('As novas senhas não conferem.');
            return;
        }
        setBusy(passwordForm, true);
        try {
            const data = await request('/api/ficha/senha', {
                method: 'PUT',
                body: JSON.stringify({
                    numero_cadastro: fichaAtual.numero_cadastro,
                    senha_atual: senhaAtual,
                    nova_senha: passwordForm.elements.nova_senha.value,
                }),
            });
            senhaAtual = passwordForm.elements.nova_senha.value;
            passwordForm.reset();
            showMessage(data.mensagem, true);
        } catch (error) {
            showMessage(error.message);
        } finally {
            setBusy(passwordForm, false);
        }
    });

    document.getElementById('logout').addEventListener('click', () => {
        fichaAtual = null;
        senhaAtual = '';
        editForm.reset();
        passwordForm.reset();
        profilePanel.hidden = true;
        loginPanel.hidden = false;
        loginForm.reset();
        showMessage('Você saiu da sua ficha.');
    });

    const cadastroInicial = new URLSearchParams(window.location.search).get('cadastro');
    if (/^\d{11}$/.test(cadastroInicial || '')) {
        loginNumber.value = cadastroInicial;
        setupNumber.value = cadastroInicial;
    }
})();
