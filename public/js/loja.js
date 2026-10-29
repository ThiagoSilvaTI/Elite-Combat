// ============================================================
// LOJA ELITE COMBAT — lógica compartilhada
// Usado em: equipamentos.html, equipamentos2.html,
//           mobile/equipamentos.html, mobile/equipamentos2.html
// ============================================================

(function () {
    'use strict';

    const WHATSAPP_NUMERO = '559885201045';
    const MOEDA = 'R$ ';

    // ================= PRODUTOS =================
    const PRODUTOS = [
        // ---- CAMISAS (2) ----
        {
            id: 'camisa-01',
            nome: 'Camisa Dry-Fit Elite Combat',
            categoria: 'camisa',
            preco: 79.90,
            img: 'https://images.unsplash.com/photo-1583743814966-8936f5b7be1a?q=80&w=800&auto=format&fit=crop',
            tamanhos: ['P', 'M', 'G', 'GG'],
        },
        {
            id: 'camisa-02',
            nome: 'Camisa Treino Premium',
            categoria: 'camisa',
            preco: 89.90,
            img: 'https://images.unsplash.com/photo-1595078475328-1ab05d0a6a0e?q=80&w=800&auto=format&fit=crop',
            tamanhos: ['P', 'M', 'G', 'GG'],
        },
        // ---- SHORTS (6) ----
        {
            id: 'short-01',
            nome: 'Short Elite Tradicional',
            categoria: 'short',
            preco: 99.90,
            img: 'https://images.unsplash.com/photo-1591195853828-11db59a44f6b?q=80&w=800&auto=format&fit=crop',
            tamanhos: ['P', 'M', 'G', 'GG'],
        },
        {
            id: 'short-02',
            nome: 'Short Elite Combat Pro',
            categoria: 'short',
            preco: 119.90,
            img: 'https://images.unsplash.com/photo-1539533018447-63fcce2678e3?q=80&w=800&auto=format&fit=crop',
            tamanhos: ['P', 'M', 'G', 'GG'],
        },
        {
            id: 'short-03',
            nome: 'Short Muay Thai Clássico',
            categoria: 'short',
            preco: 109.90,
            img: 'https://images.unsplash.com/photo-1600185365483-26d7a4cc7519?q=80&w=800&auto=format&fit=crop',
            tamanhos: ['P', 'M', 'G', 'GG'],
        },
        {
            id: 'short-04',
            nome: 'Short Treino Black Edition',
            categoria: 'short',
            preco: 94.90,
            img: 'https://images.unsplash.com/photo-1584464491033-06628f3a6b7b?q=80&w=800&auto=format&fit=crop',
            tamanhos: ['P', 'M', 'G', 'GG'],
        },
        {
            id: 'short-05',
            nome: 'Short Competição',
            categoria: 'short',
            preco: 129.90,
            img: 'https://images.unsplash.com/photo-1594633312681-425c7b97ccd1?q=80&w=800&auto=format&fit=crop',
            tamanhos: ['P', 'M', 'G', 'GG'],
        },
        {
            id: 'short-06',
            nome: 'Short Infantil Elite',
            categoria: 'short',
            preco: 79.90,
            img: 'https://images.unsplash.com/photo-1571945153237-4929e783af4a?q=80&w=800&auto=format&fit=crop',
            tamanhos: ['4', '6', '8', '10', '12'],
        },
    ];

    // ================= ESTADO =================
    const carrinho = {};       // { chave: { produto, tamanho, qtd } }
    const selecionados = {};   // { produtoId: tamanho }

    // ================= HELPERS =================
    function formatarPreco(v) {
        return MOEDA + v.toFixed(2).replace('.', ',');
    }

    function totalItens() {
        return Object.values(carrinho).reduce((s, i) => s + i.qtd, 0);
    }

    function totalValor() {
        return Object.values(carrinho).reduce((s, i) => s + i.produto.preco * i.qtd, 0);
    }

    // ================= GRID =================
    function renderizarGrid(filtro) {
        const grid = document.getElementById('shopGrid');
        if (!grid) return;

        const lista = filtro === 'todos'
            ? PRODUTOS
            : PRODUTOS.filter(p => p.categoria === filtro);

        grid.innerHTML = lista.map(p => `
            <div class="shop-card" data-id="${p.id}">
                <div class="shop-img">
                    <img src="${p.img}" alt="${p.nome}" loading="lazy">
                </div>
                <div class="shop-info">
                    <div class="categoria">${p.categoria === 'camisa' ? 'Camisa' : 'Short'}</div>
                    <h3>${p.nome}</h3>
                    <div class="preco">${formatarPreco(p.preco)}</div>
                    <div class="tamanhos" data-id="${p.id}">
                        ${p.tamanhos.map(t => `<button data-tam="${t}">${t}</button>`).join('')}
                    </div>
                    <button class="btn-add" data-add="${p.id}" disabled>Selecione o tamanho</button>
                </div>
            </div>
        `).join('');

        // Eventos de tamanho
        grid.querySelectorAll('.tamanhos').forEach(bloco => {
            const id = bloco.dataset.id;
            bloco.querySelectorAll('button').forEach(btn => {
                btn.addEventListener('click', () => {
                    bloco.querySelectorAll('button').forEach(b => b.classList.remove('selected'));
                    btn.classList.add('selected');
                    selecionados[id] = btn.dataset.tam;
                    const card = grid.querySelector(`.shop-card[data-id="${id}"]`);
                    card.classList.add('selected');
                    const addBtn = card.querySelector('.btn-add');
                    addBtn.disabled = false;
                    addBtn.textContent = 'Adicionar ao pedido';
                });
            });
        });

        // Eventos de adicionar com animação
        grid.querySelectorAll('.btn-add').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.add;
                const tam = selecionados[id];
                if (!tam) return;

                // Efeito de "clique"
                btn.classList.add('clicked');
                setTimeout(() => btn.classList.remove('clicked'), 200);

                // Animação fly-to-cart
                const card = btn.closest('.shop-card');
                const img = card.querySelector('.shop-img img');
                animarVooAoCarrinho(img, () => {
                    adicionarAoCarrinho(id, tam);
                });
            });
        });
    }

    // ================= ANIMAÇÃO FLY-TO-CART =================
    function animarVooAoCarrinho(imgOrigem, callback) {
        const cartBtn = document.getElementById('cartFloatingBtn');
        if (!cartBtn || !imgOrigem) {
            callback();
            return;
        }

        const rectOrigem = imgOrigem.getBoundingClientRect();
        const rectDestino = cartBtn.getBoundingClientRect();

        // Clona a imagem
        const clone = document.createElement('img');
        clone.src = imgOrigem.src;
        clone.style.cssText = `
            position: fixed;
            top: ${rectOrigem.top}px;
            left: ${rectOrigem.left}px;
            width: ${rectOrigem.width}px;
            height: ${rectOrigem.height}px;
            object-fit: cover;
            border-radius: 8px;
            z-index: 10000;
            pointer-events: none;
            box-shadow: 0 10px 30px rgba(0,0,0,0.6);
            transition: top 0.8s cubic-bezier(0.5, -0.3, 0.7, 1.3),
                        left 0.8s cubic-bezier(0.5, -0.3, 0.7, 1.3),
                        width 0.8s ease-out,
                        height 0.8s ease-out,
                        opacity 0.3s ease-out 0.6s,
                        border-radius 0.8s ease-out;
        `;
        document.body.appendChild(clone);

        // Força reflow
        void clone.offsetWidth;

        // Aplica destino
        clone.style.top = `${rectDestino.top + rectDestino.height / 2 - 20}px`;
        clone.style.left = `${rectDestino.left + rectDestino.width / 2 - 20}px`;
        clone.style.width = '40px';
        clone.style.height = '40px';
        clone.style.borderRadius = '50%';
        clone.style.opacity = '0';

        // Callback + limpeza
        setTimeout(() => {
            callback();
            // Pulso no carrinho
            cartBtn.classList.add('pulse');
            setTimeout(() => cartBtn.classList.remove('pulse'), 400);
        }, 750);

        setTimeout(() => clone.remove(), 1100);
    }

    // ================= CARRINHO =================
    function adicionarAoCarrinho(id, tamanho) {
        const produto = PRODUTOS.find(p => p.id === id);
        if (!produto) return;

        const chave = id + '|' + tamanho;
        if (carrinho[chave]) carrinho[chave].qtd++;
        else carrinho[chave] = { produto, tamanho, qtd: 1 };

        atualizarCarrinhoFlutuante();
        atualizarModalCarrinho();
    }

    function removerDoCarrinho(chave) {
        delete carrinho[chave];
        atualizarCarrinhoFlutuante();
        atualizarModalCarrinho();
    }

    function alterarQtd(chave, delta) {
        if (!carrinho[chave]) return;
        carrinho[chave].qtd += delta;
        if (carrinho[chave].qtd <= 0) delete carrinho[chave];
        atualizarCarrinhoFlutuante();
        atualizarModalCarrinho();
    }

    // ================= CARRINHO FLUTUANTE =================
    function atualizarCarrinhoFlutuante() {
        const btn = document.getElementById('cartFloatingBtn');
        if (!btn) return;

        const qtd = totalItens();
        const total = totalValor();

        btn.querySelector('.cart-count').textContent = qtd;
        btn.querySelector('.cart-total').textContent = formatarPreco(total);

        if (qtd > 0) {
            btn.classList.add('visible');
            btn.classList.remove('vazio');
        } else {
            btn.classList.remove('visible');
            btn.classList.add('vazio');
        }
    }

    // ================= MODAL CARRINHO =================
    function atualizarModalCarrinho() {
        const lista = document.getElementById('cartModalLista');
        const totalEl = document.getElementById('cartModalTotal');
        const btnWhats = document.getElementById('btnWhats');
        if (!lista) return;

        const chaves = Object.keys(carrinho);
        if (!chaves.length) {
            lista.innerHTML = '<div class="cart-empty">Seu carrinho está vazio.</div>';
            totalEl.textContent = formatarPreco(0);
            if (btnWhats) btnWhats.disabled = true;
            return;
        }

        lista.innerHTML = chaves.map(chave => {
            const item = carrinho[chave];
            const sub = item.produto.preco * item.qtd;
            return `
                <div class="cart-item">
                    <img src="${item.produto.img}" alt="">
                    <div class="cart-item-info">
                        <strong>${item.produto.nome}</strong>
                        <small>Tamanho: ${item.tamanho}</small>
                        <div class="cart-item-qtd">
                            <button data-menos="${chave}">−</button>
                            <span>${item.qtd}</span>
                            <button data-mais="${chave}">+</button>
                            <button class="cart-remover" data-rem="${chave}">✕</button>
                        </div>
                    </div>
                    <div class="cart-item-sub">${formatarPreco(sub)}</div>
                </div>
            `;
        }).join('');

        totalEl.textContent = formatarPreco(totalValor());
        if (btnWhats) btnWhats.disabled = false;

        lista.querySelectorAll('[data-menos]').forEach(b =>
            b.addEventListener('click', () => alterarQtd(b.dataset.menos, -1)));
        lista.querySelectorAll('[data-mais]').forEach(b =>
            b.addEventListener('click', () => alterarQtd(b.dataset.mais, 1)));
        lista.querySelectorAll('[data-rem]').forEach(b =>
            b.addEventListener('click', () => removerDoCarrinho(b.dataset.rem)));
    }

    // ================= MODAL ABRIR/FECHAR =================
    function abrirModal() {
        const bg = document.getElementById('cartModalBg');
        if (!bg) return;
        bg.classList.add('active');
        document.body.style.overflow = 'hidden';
        atualizarModalCarrinho();
    }

    function fecharModal() {
        const bg = document.getElementById('cartModalBg');
        if (!bg) return;
        bg.classList.remove('active');
        document.body.style.overflow = '';
    }

    // ================= ENVIAR WHATSAPP =================
    function enviarWhatsApp() {
        const nome = (document.getElementById('clienteNome') || {}).value || '';
        const tel = (document.getElementById('clienteTelefone') || {}).value || '';
        const obs = (document.getElementById('clienteObs') || {}).value || '';
        const aviso = document.getElementById('avisoForm');

        if (!nome.trim() || !tel.trim()) {
            if (aviso) {
                aviso.textContent = 'Preencha seu nome e telefone para continuar.';
                aviso.classList.add('active');
                aviso.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            return;
        }
        if (aviso) aviso.classList.remove('active');

        const chaves = Object.keys(carrinho);
        if (!chaves.length) return;

        let itensTexto = '';
        chaves.forEach((chave, idx) => {
            const item = carrinho[chave];
            const sub = item.produto.preco * item.qtd;
            itensTexto += `\n${idx + 1}. *${item.produto.nome}*\n   Tamanho: ${item.tamanho}\n   Qtd: ${item.qtd}\n   Subtotal: ${formatarPreco(sub)}`;
        });

        const mensagem =
            `*NOVO PEDIDO — ELITE COMBAT*\n\n` +
            `*Nome:* ${nome.trim()}\n` +
            `*Telefone:* ${tel.trim()}\n` +
            `${obs.trim() ? `*Observações:* ${obs.trim()}\n` : ''}` +
            `\n*ITENS DO PEDIDO:*${itensTexto}\n\n` +
            `*TOTAL:* ${formatarPreco(totalValor())}\n\n` +
            `_Pedido enviado pelo site Elite Combat_`;

        const url = `https://wa.me/${WHATSAPP_NUMERO}?text=${encodeURIComponent(mensagem)}`;
        window.open(url, '_blank');

        // Limpa
        Object.keys(carrinho).forEach(k => delete carrinho[k]);
        const n = document.getElementById('clienteNome');
        const t = document.getElementById('clienteTelefone');
        const o = document.getElementById('clienteObs');
        if (n) n.value = '';
        if (t) t.value = '';
        if (o) o.value = '';
        atualizarCarrinhoFlutuante();
        atualizarModalCarrinho();
        fecharModal();

        // Reseta seleções visuais
        document.querySelectorAll('.shop-card').forEach(c => c.classList.remove('selected'));
        document.querySelectorAll('.tamanhos button').forEach(b => b.classList.remove('selected'));
        document.querySelectorAll('.btn-add').forEach(b => {
            b.disabled = true;
            b.textContent = 'Selecione o tamanho';
        });
    }

    // ================= INIT =================
    function init() {
        const grid = document.getElementById('shopGrid');
        if (!grid) return; // Não é página de loja

        renderizarGrid('todos');
        atualizarCarrinhoFlutuante();

        // Filtros
        document.querySelectorAll('.filtro').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.filtro').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                renderizarGrid(btn.dataset.filtro);
            });
        });

        // Botão flutuante
        const cartBtn = document.getElementById('cartFloatingBtn');
        if (cartBtn) {
            cartBtn.addEventListener('click', abrirModal);
        }

        // Fechar modal
        const bg = document.getElementById('cartModalBg');
        if (bg) {
            bg.addEventListener('click', (e) => {
                if (e.target.id === 'cartModalBg') fecharModal();
            });
        }
        const btnFechar = document.getElementById('btnFecharCart');
        if (btnFechar) btnFechar.addEventListener('click', fecharModal);

        // Enviar WhatsApp
        const btnWhats = document.getElementById('btnWhats');
        if (btnWhats) btnWhats.addEventListener('click', enviarWhatsApp);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();