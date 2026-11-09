(function () {
    const storageKey = 'eliteCombatSiteTour';
    const filename = window.location.pathname.split('/').pop() || 'index.html';
    const steps = [
        {
            page: 'index.html',
            target: '.hero-content',
            title: 'Bem-vindo à Elite Combat!',
            text: 'Este tour apresenta a academia, as aulas, os equipamentos, os canais de contato e o caminho para fazer sua inscrição.'
        },
        {
            page: 'aulas.html',
            target: '.section-header',
            title: 'Conheça as turmas',
            text: 'Explore as opções de treino. Na inscrição, a turma do aluno é definida automaticamente pela data de nascimento.'
        },
        {
            page: 'equipamentos.html',
            target: '.section-header',
            title: 'Equipamentos',
            text: 'Aqui você encontra os equipamentos disponíveis na loja da Elite Combat.'
        },
        {
            page: 'contato.html',
            target: '.section-header',
            title: 'Fale com a equipe',
            text: 'Consulte a localização e os canais de contato para tirar dúvidas com a academia.'
        },
        {
            page: 'inscricao.html',
            target: '.section-header',
            title: 'Faça sua inscrição',
            text: 'Preencha um card por vez usando “Avançar” e “Voltar”. A turma é calculada pela idade; menores de 18 anos também preenchem os dados do responsável e o contato de emergência. Para se inscrever como Instrutor, selecione essa opção e confirme a autorização do professor.'
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
            return true;
        } catch (error) {
            console.warn('Não foi possível salvar o progresso do tour:', error);
            return false;
        }
    }

    const state = readState();
    const styleLink = document.createElement('link');
    styleLink.rel = 'stylesheet';
    styleLink.href = window.location.pathname.includes('/mobile/')
        ? '../css/site-tour.css'
        : 'css/site-tour.css';
    document.head.appendChild(styleLink);

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'site-tour-trigger';
    trigger.textContent = 'Tour do site';
    trigger.setAttribute('aria-label', 'Abrir tour do site');

    const backdrop = document.createElement('div');
    backdrop.className = 'site-tour-backdrop';
    backdrop.hidden = true;
    backdrop.innerHTML = `
        <section class="site-tour-dialog" role="dialog" aria-modal="true" aria-labelledby="siteTourTitle" aria-describedby="siteTourText">
            <button type="button" class="site-tour-close" aria-label="Pular tour">×</button>
            <p class="site-tour-count" aria-live="polite"></p>
            <h2 id="siteTourTitle"></h2>
            <p id="siteTourText"></p>
            <div class="site-tour-actions">
                <button type="button" class="site-tour-skip">Pular tour</button>
                <div class="site-tour-navigation">
                    <button type="button" class="site-tour-back">Voltar</button>
                    <button type="button" class="site-tour-next">Próximo</button>
                </div>
            </div>
        </section>
    `;

    document.body.append(trigger, backdrop);

    const count = backdrop.querySelector('.site-tour-count');
    const title = backdrop.querySelector('#siteTourTitle');
    const text = backdrop.querySelector('#siteTourText');
    const backButton = backdrop.querySelector('.site-tour-back');
    const nextButton = backdrop.querySelector('.site-tour-next');
    const closeButton = backdrop.querySelector('.site-tour-close');
    const skipButton = backdrop.querySelector('.site-tour-skip');
    let activeTarget = null;

    function currentPage() {
        return filename;
    }

    function clearHighlight() {
        if (activeTarget) activeTarget.classList.remove('site-tour-highlight');
        activeTarget = null;
    }

    function closeTour(skipped) {
        clearHighlight();
        backdrop.hidden = true;
        document.body.classList.remove('site-tour-open');
        if (skipped) saveState({ dismissed: true });
        else saveState({ completed: true });
        trigger.focus();
    }

    function showStep(index) {
        const step = steps[index];
        if (!step) {
            closeTour(false);
            return;
        }

        if (currentPage() !== step.page) {
            saveState({ active: true, step: index });
            window.location.assign(step.page);
            return;
        }

        clearHighlight();
        const target = document.querySelector(step.target);
        if (target) {
            activeTarget = target;
            activeTarget.classList.add('site-tour-highlight');
            activeTarget.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }

        count.textContent = `Passo ${index + 1} de ${steps.length}`;
        title.textContent = step.title;
        text.textContent = step.text;
        backButton.hidden = index === 0;
        nextButton.textContent = index === steps.length - 1 ? 'Concluir' : 'Próximo';
        backdrop.hidden = false;
        document.body.classList.add('site-tour-open');
        saveState({ active: true, step: index });
        nextButton.focus();
    }

    function startTour() {
        showStep(0);
    }

    trigger.addEventListener('click', startTour);
    nextButton.addEventListener('click', () => {
        const current = readState();
        showStep((Number.isInteger(current.step) ? current.step : 0) + 1);
    });
    backButton.addEventListener('click', () => {
        const current = readState();
        showStep(Math.max(0, (Number.isInteger(current.step) ? current.step : 0) - 1));
    });
    closeButton.addEventListener('click', () => closeTour(true));
    skipButton.addEventListener('click', () => closeTour(true));
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !backdrop.hidden) closeTour(true);
    });

    if (state.active && Number.isInteger(state.step)) {
        showStep(Math.min(Math.max(state.step, 0), steps.length - 1));
    } else if (!state.completed && !state.dismissed) {
        startTour();
    }
})();
