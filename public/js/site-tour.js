(function () {
    const storageKey = 'eliteCombatSiteTourV2';
    const filename = window.location.pathname.split('/').pop() || 'index.html';
    const siteSteps = [
        {
            page: 'index.html',
            target: '.hero-content',
            title: 'Bem-vindo à Elite Combat!',
            text: 'Conheça a academia e use o menu para explorar as aulas, os equipamentos e os canais de contato.'
        },
        {
            page: 'aulas.html',
            target: '.inscricao-cta, .btn-inscricao',
            title: 'Encontre onde se inscrever',
            text: 'Para fazer sua inscrição, clique em “Quero me Inscrever” nesta página. O tour não abre nem preenche a ficha por você.'
        },
        {
            page: 'equipamentos.html',
            target: '.section-header',
            title: 'Equipamentos',
            text: 'Veja os equipamentos disponíveis na loja da Elite Combat.'
        },
        {
            page: 'contato.html',
            target: '.section-header',
            title: 'Fale com a equipe',
            text: 'Consulte a localização e os canais de contato da academia.'
        },
        {
            page: 'contato.html',
            target: '#feedback',
            title: 'Deixe seu feedback',
            text: 'No final do tour, você também pode avaliar o site e deixar uma recomendação nesta área. É opcional: o tour não preenche nem envia o formulário por você.',
            scrollIntoView: true
        }
    ];

    function readState() {
        try {
            const state = JSON.parse(localStorage.getItem(storageKey) || '{}');
            return state && typeof state === 'object' ? state : {};
        } catch (error) {
            console.warn('Não foi possível ler o progresso do tour:', error);
            return {};
        }
    }

    function saveState(state) {
        try {
            localStorage.setItem(storageKey, JSON.stringify(state));
        } catch (error) {
            console.warn('Não foi possível salvar o progresso do tour:', error);
        }
    }

    const styleLink = document.createElement('link');
    styleLink.rel = 'stylesheet';
    styleLink.href = window.location.pathname.includes('/mobile/')
        ? '../css/site-tour.css'
        : 'css/site-tour.css';
    document.head.appendChild(styleLink);

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'site-tour-trigger';
    trigger.textContent = 'Ajuda do tour';
    trigger.setAttribute('aria-label', 'Abrir ajuda do site');

    const panel = document.createElement('aside');
    panel.className = 'site-tour-panel';
    panel.hidden = true;
    panel.innerHTML = `
        <section class="site-tour-dialog" aria-labelledby="siteTourTitle" aria-describedby="siteTourText">
            <button type="button" class="site-tour-close" aria-label="Fechar ajuda">×</button>
            <p class="site-tour-count" aria-live="polite"></p>
            <h2 id="siteTourTitle"></h2>
            <p id="siteTourText"></p>
            <div class="site-tour-actions">
                <button type="button" class="site-tour-back">Voltar</button>
                <button type="button" class="site-tour-next">Próximo</button>
            </div>
        </section>
    `;
    document.body.append(trigger, panel);

    const count = panel.querySelector('.site-tour-count');
    const title = panel.querySelector('#siteTourTitle');
    const text = panel.querySelector('#siteTourText');
    const closeButton = panel.querySelector('.site-tour-close');
    const backButton = panel.querySelector('.site-tour-back');
    const nextButton = panel.querySelector('.site-tour-next');
    let activeTarget = null;
    let currentSiteStep = 0;
    let helpWasClosed = false;

    function highlight(targetSelector) {
        if (activeTarget) activeTarget.classList.remove('site-tour-highlight');
        activeTarget = document.querySelector(targetSelector);
        if (activeTarget) activeTarget.classList.add('site-tour-highlight');
    }

    function showPanel(stepCount, heading, description, targetSelector) {
        count.textContent = stepCount;
        title.textContent = heading;
        text.textContent = description;
        highlight(targetSelector);
        panel.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');
    }

    function closePanel() {
        panel.hidden = true;
        if (activeTarget) activeTarget.classList.remove('site-tour-highlight');
        activeTarget = null;
        trigger.setAttribute('aria-expanded', 'false');
    }

    function showSiteStep(index) {
        const step = siteSteps[index];
        if (!step) {
            saveState({ completed: true });
            closePanel();
            return;
        }

        if (filename !== step.page) {
            saveState({ active: true, step: index });
            window.location.assign(step.page);
            return;
        }

        currentSiteStep = index;
        showPanel(
            `Tour do site · ${index + 1} de ${siteSteps.length}`,
            step.title,
            step.text,
            step.target
        );
        if (step.scrollIntoView) {
            const target = document.querySelector(step.target);
            if (target) {
                target.scrollIntoView({
                    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
                        ? 'auto'
                        : 'smooth',
                    block: 'start'
                });
            }
        }
        backButton.hidden = index === 0;
        nextButton.textContent = index === siteSteps.length - 1 ? 'Concluir' : 'Próximo';
        saveState({ active: true, step: index });
    }

    function getEnrollmentStep() {
        const cards = Array.from(document.querySelectorAll('#formInscricao .form-step'));
        const card = cards.find(item => !item.hidden);
        if (!card) return null;

        const headingElement = card.querySelector('h3');
        const heading = headingElement ? headingElement.textContent.trim() : 'Esta etapa';
        const headingKey = heading.toLowerCase();
        const descriptions = [
            ['dados pessoais', 'Informe o nome, a data de nascimento e o telefone do aluno. A turma é calculada automaticamente pela idade; a inscrição começa a partir dos 4 anos.'],
            ['turma e experiência', 'Confira a turma calculada pela idade e informe os horários e experiências. Se escolher “Instrutor”, confirme a autorização do professor para continuar.'],
            ['responsável', 'Este card aparece para alunos menores de 18 anos. Preencha os dados do responsável legal.'],
            ['emergência', 'Este card também é exibido para menores de 18 anos. Informe um contato diferente do telefone do aluno.'],
            ['saúde', 'Responda cada pergunta. Quando marcar “Sim”, descreva a informação importante e confirme a autorização para o uso dos dados de saúde.'],
            ['declaração', 'Revise os dados e conclua para gerar o contrato de inscrição.']
        ];
        const match = descriptions.find(([key]) => headingKey.includes(key));
        const progressLabel = card.querySelector('.step-navigation span');
        const progress = progressLabel ? progressLabel.textContent.trim() : '';
        return {
            heading,
            description: match ? match[1] : 'Preencha os campos deste card e use os botões para avançar ou voltar.',
            progress
        };
    }

    function showEnrollmentHelp() {
        const step = getEnrollmentStep();
        if (!step) return;
        showPanel(
            step.progress || 'Ajuda da inscrição',
            `Sobre: ${step.heading}`,
            step.description,
            '#formInscricao .form-step:not([hidden])'
        );
        backButton.hidden = true;
        nextButton.hidden = true;
    }

    function startHelp() {
        if (filename === 'inscricao.html') {
            const state = readState();
            if (state.active) saveState({ completed: true });
            helpWasClosed = false;
            showEnrollmentHelp();
            return;
        }

        const currentIndex = siteSteps.findIndex(step => step.page === filename);
        showSiteStep(currentIndex < 0 ? 0 : currentIndex);
    }

    trigger.setAttribute('aria-expanded', 'false');
    trigger.addEventListener('click', startHelp);
    closeButton.addEventListener('click', () => {
        if (filename === 'inscricao.html') helpWasClosed = true;
        else saveState({ dismissed: true });
        closePanel();
    });
    nextButton.addEventListener('click', () => showSiteStep(currentSiteStep + 1));
    backButton.addEventListener('click', () => showSiteStep(Math.max(0, currentSiteStep - 1)));

    if (filename === 'inscricao.html') {
        const form = document.getElementById('formInscricao');
        if (form) {
            const observer = new MutationObserver(() => {
                if (!helpWasClosed) showEnrollmentHelp();
            });
            form.querySelectorAll('.form-step').forEach(card => {
                observer.observe(card, { attributes: true, attributeFilter: ['hidden'] });
            });
            showEnrollmentHelp();
        }
        return;
    }

    const state = readState();
    if (state.active && Number.isInteger(state.step)) {
        const nextStep = siteSteps[state.step];
        if (nextStep && nextStep.page === filename) showSiteStep(state.step);
    } else if (!state.completed && !state.dismissed) {
        const initialIndex = siteSteps.findIndex(step => step.page === filename);
        if (initialIndex >= 0) showSiteStep(initialIndex);
    }
})();
