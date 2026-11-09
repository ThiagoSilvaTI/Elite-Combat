(function () {
    'use strict';

    const form = document.getElementById('feedbackForm');
    const list = document.getElementById('feedbackList');
    const status = document.getElementById('feedbackStatus');
    if (!form || !list || !status) return;

    const ratingField = form.querySelector('.feedback-rating');
    const submitButton = form.querySelector('[type="submit"]');

    function renderFeedback(feedbacks) {
        list.replaceChildren();

        if (!feedbacks.length) {
            const empty = document.createElement('p');
            empty.className = 'feedback-empty';
            empty.textContent = 'Ainda não há recomendações. Seja o primeiro aluno a avaliar o site.';
            list.appendChild(empty);
            return;
        }

        feedbacks.forEach((feedback) => {
            const card = document.createElement('article');
            card.className = 'feedback-card';

            const heading = document.createElement('div');
            heading.className = 'feedback-card-heading';

            const name = document.createElement('h3');
            name.textContent = feedback.nome;

            const stars = document.createElement('span');
            stars.className = 'feedback-card-stars';
            stars.textContent = `${'★'.repeat(feedback.nota)}${'☆'.repeat(5 - feedback.nota)}`;
            stars.setAttribute('aria-label', `Nota ${feedback.nota} de 5`);

            const recommendation = document.createElement('p');
            recommendation.textContent = feedback.recomendacao;

            heading.append(name, stars);
            card.append(heading, recommendation);
            list.appendChild(card);
        });
    }

    async function loadFeedback() {
        try {
            const response = await fetch('/api/feedback');
            const data = await response.json();
            if (!response.ok || !data.ok) {
                throw new Error(data.erro || 'Não foi possível carregar os feedbacks.');
            }
            renderFeedback(data.feedbacks);
        } catch (error) {
            const message = document.createElement('p');
            message.className = 'feedback-empty';
            message.textContent = error.message || 'Não foi possível carregar os feedbacks.';
            list.replaceChildren(message);
        }
    }

    form.querySelectorAll('input[name="nota"]').forEach((input) => {
        input.addEventListener('change', () => {
            ratingField.dataset.rating = input.value;
        });
    });

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        status.textContent = '';
        status.classList.remove('error');
        submitButton.disabled = true;

        try {
            const response = await fetch('/api/feedback', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    numero_cadastro: form.elements.numero_cadastro.value,
                    telefone: form.elements.telefone.value,
                    nota: Number(form.elements.nota.value),
                    recomendacao: form.elements.recomendacao.value,
                    consentimento: form.elements.consentimento.checked
                })
            });
            const data = await response.json();
            if (!response.ok || !data.ok) {
                throw new Error(data.erro || 'Não foi possível enviar o feedback.');
            }

            status.textContent = data.mensagem;
            form.reset();
            delete ratingField.dataset.rating;
            await loadFeedback();
        } catch (error) {
            status.textContent = error.message || 'Não foi possível enviar o feedback.';
            status.classList.add('error');
        } finally {
            submitButton.disabled = false;
        }
    });

    loadFeedback();
})();
