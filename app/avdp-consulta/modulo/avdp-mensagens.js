// AVDP Mensagens — módulo do Holyrics (cole este arquivo inteiro na janela Módulos).
//
// Pesquisa as Mensagens do AVDP Busca (mesma busca do app: modos, "frase", -excluir, OU, prefixo*,
// parecida~, titulo:, código da data), projeta a mensagem inteira a partir do § pela apresentação
// rápida do Holyrics, adiciona à lista de reprodução aberta e importa a fila exportada pelo AVDP
// (.avdpfila).
//
// As mensagens ficam num banco próprio (C:\AVDP Holyrics\avdp-mensagens.db), lido pelo programa
// avdp-consulta.exe, que precisa estar na aba Arquivos da biblioteca do Holyrics e liberado na
// permissão "allowed_files" deste módulo. Passo a passo: LEIA-ME - PASSO A PASSO.txt do pacote.
//
// JavaScript ES5 (sem let/const, crase ou funções de seta), só a API documentada em
// github.com/holyrics/jslib e github.com/holyrics/JSCommunity (src/modules).

var EXE_PADRAO = 'avdp-consulta.exe';
var ITEM_ACAO = 'Busca o texto na hora (ação do módulo)';
var ITEM_TEXTO = 'Texto copiado na lista';
var MODOS = [
    ['all', 'Todas as palavras'],
    ['exact', 'Frase exata'],
    ['any', 'Qualquer palavra'],
    ['near', 'Palavras próximas']
];
var TRADUCOES = {
    GVD: 'Gravações A Voz de Deus',
    GO: 'A Palavra Original (Goiânia-GO)',
    CB: 'Crentes da Bíblia (Chapecó-SC)',
    VSA: 'A Voz do Sétimo Anjo',
    EUA: 'Tradução feita nos EUA'
};
var FONTES = { local: 'banco local', cbb: 'Busca CBB', tdf: 'Tabernáculo da Fé' };

function info() {
    return {
        id: 'avdp_mensagens',
        name: 'AVDP Mensagens',
        description: '<b>Mensagens do AVDP Busca</b> no Holyrics: pesquisar, projetar a mensagem inteira a partir do §, '
            + 'adicionar à lista e importar a fila do AVDP (.avdpfila).<br>'
            + 'Precisa do <b>avdp-consulta.exe</b> na aba Arquivos da biblioteca (liberado em <i>allowed_files</i>) '
            + 'e do banco em <b>C:\\AVDP Holyrics\\avdp-mensagens.db</b>.',
        min_version: '2.26.0',
        os_required: 'windows',
        available_in_main_window: true,
        available_in_bible_window: false,
        permissions: [
            { type: 'advanced', key: 'allowed_files' }
        ]
    };
}

function settings(moduleInfo) {
    return [
        { id: 'tema', name: 'Tema das mensagens (vazio = tema padrão da apresentação rápida)', type: 'theme' },
        { id: 'caracteres', name: 'Máximo de caracteres por slide (parágrafo maior é dividido)', type: 'number', min: 120, max: 1200, default_value: 420 },
        { id: 'rodape', name: 'Rodapé com código da mensagem e § em cada slide', type: 'boolean', default_value: true },
        // padrão = texto copiado: o item da ação do módulo aparece na lista só como "Mostrar mensagem do AVDP"
        { id: 'item_lista', name: 'Mensagem na lista de reprodução', type: 'string', allowed_values: [ITEM_TEXTO, ITEM_ACAO], default_value: ITEM_TEXTO },
        { id: 'limite', name: 'Máximo de resultados na pesquisa', type: 'number', min: 20, max: 300, default_value: 80 },
        { id: 'banco', name: 'Banco das mensagens (vazio = C:\\AVDP Holyrics\\avdp-mensagens.db)', type: 'string', max_length: 400, default_value: '' },
        { id: 'exe', name: 'Programa de consulta (nome na aba Arquivos)', type: 'string', max_length: 200, default_value: EXE_PADRAO },
        { id: 'avdp', name: 'AVDP Busca Plugin (vazio = %LOCALAPPDATA%\\AVDP Busca Plugin\\avdp-busca-plugin.exe)', type: 'string', max_length: 400, default_value: '' },
        {
            id: 'todas_opcoes', name: 'Mostrar todas as opções no painel (desligado: só o botão AVDP Busca)', type: 'boolean', default_value: false,
            // o Holyrics só refaz os botões quando pedido: ao marcar/desmarcar guarda a escolha e redesenha o painel
            onchange: function (obj) {
                var v = obj && obj.input ? obj.input.todas_opcoes : null;
                module.setGlobal('todas_opcoes', v === true || String(v) === 'true');
                module.updatePanel();
            }
        }
    ];
}

// ---------- ações (botões no painel do módulo) ----------

function actions(moduleInfo) {
    var todas = [
        {
            id: 'abrir_avdp',
            name: 'AVDP Busca',
            hint: 'Abre o AVDP Busca numa janela própria (Mensagens e Bíblia); ele projeta por aqui. "Ir para Holyrics" volta.',
            icon: 'menu_book',
            action: seguro(acaoAbrirAvdp)
        },
        {
            id: 'aplicar_visual',
            name: 'Aplicar visual do AVDP',
            hint: 'Cria no Holyrics o tema das letras do AVDP (fundo, fonte, margens) e põe o papel de parede (F8) do AVDP',
            icon: 'palette',
            action: seguro(acaoAplicarVisual)
        },
        {
            id: 'pesquisar',
            name: 'Pesquisar mensagem',
            hint: 'Procura nas Mensagens do AVDP e projeta a partir do § ou adiciona à lista',
            icon: 'search',
            action: seguro(acaoPesquisar)
        },
        {
            id: 'abrir_data',
            name: 'Abrir por data',
            hint: 'Abre a mensagem pelo código da data (ex.: 65-1127B) ou por palavras do título',
            icon: 'event',
            action: seguro(acaoAbrirPorData)
        },
        {
            id: 'adicionar_lista',
            name: 'Adicionar à lista',
            hint: 'Adiciona à lista de reprodução a mensagem em projeção, a partir do § que está na tela',
            icon: 'playlist_add',
            action: seguro(acaoAdicionarAtual)
        },
        {
            id: 'importar_fila',
            name: 'Importar fila do AVDP',
            hint: 'Monta na lista de reprodução aberta a fila exportada pelo AVDP Busca (.avdpfila)',
            icon: 'file_download',
            action: seguro(acaoImportarFila)
        },
        {
            id: 'conferir',
            name: 'Conferir',
            hint: 'Confere o programa de consulta, o banco das mensagens e o tamanho das respostas',
            icon: 'fact_check',
            action: seguro(acaoConferir)
        }
    ];
    // configuração "Mostrar todas as opções" desligada: o painel fica só com o botão AVDP Busca
    // escolha recém-confirmada (validator) vale antes da configuração salva ser relida
    var g = module.getGlobal('todas_opcoes', null);
    var s = (g === true || g === false) ? g : cfg('todas_opcoes', false);
    return (s === true || String(s) === 'true') ? todas : [todas[0]];
}

// Item da lista de reprodução e outros scripts: projeta a mensagem buscando o texto na hora.
function publicActions(module) {
    return [
        {
            id: 'show_paragraph',
            name: 'Mostrar mensagem do AVDP',
            description: 'Projeta a mensagem inteira a partir do § (texto lido do banco do plugin na hora).',
            icon: 'menu_book',
            available_for: 'ui,add_to_playlist,trigger,jslib_call',
            input: [
                { id: 'name', name: 'Mensagem', type: 'string', max_length: 300 },
                { id: 'source', name: 'Fonte', type: 'string' },
                { id: 'source_id', name: 'Id na fonte', type: 'string', max_length: 200 },
                { id: 'variant', name: 'Tradução (id no banco)', type: 'string' },
                { id: 'num', name: '§', type: 'string' }
            ],
            action: function (evt) {
                var inp = (evt && evt.input) ? evt.input : {};
                // devolve logo (o tempo de uma ação chamada de fora é curto); o trabalho segue no timer
                module.setTimeout(function () {
                    try {
                        mostrarDoItem(inp);
                    } catch (e) {
                        erro(e);
                    }
                }, 1);
                return true;
            }
        }
    ];
}

// ---------- utilidades ----------

function seguro(fn) {
    return function (evt) {
        try {
            fn(evt);
        } catch (e) {
            erro(e);
        }
    };
}

function erro(e) {
    var m = (e && e.message) ? e.message : String(e);
    try { module.log('erro: ' + m); } catch (x) { /* sem log */ }
    h.notificationError('AVDP Mensagens: ' + m, 12);
}

function cfg(key, def) {
    var s = module.settings;
    var v = s ? s[key] : null;
    if (v === undefined || v === null || String(v) === '') {
        return def;
    }
    return v;
}

function caracteres() {
    var n = Number(cfg('caracteres', 420));
    return (n >= 120 && n <= 1200) ? Math.round(n) : 420;
}

function hx(b) {
    return (b < 16 ? '0' : '') + b.toString(16);
}

// Texto em hexadecimal (bytes UTF-8, prefixo x:): aspas, acentos e espaços chegam inteiros ao programa.
function hexUtf8(s) {
    s = String(s);
    var out = 'x:';
    for (var i = 0; i < s.length; i++) {
        var c = s.charCodeAt(i);
        if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length) {
            var d = s.charCodeAt(i + 1);
            if (d >= 0xDC00 && d <= 0xDFFF) {
                c = 0x10000 + ((c - 0xD800) << 10) + (d - 0xDC00);
                i++;
            }
        }
        if (c < 0x80) {
            out += hx(c);
        } else if (c < 0x800) {
            out += hx(0xC0 | (c >> 6)) + hx(0x80 | (c & 63));
        } else if (c < 0x10000) {
            out += hx(0xE0 | (c >> 12)) + hx(0x80 | ((c >> 6) & 63)) + hx(0x80 | (c & 63));
        } else {
            out += hx(0xF0 | (c >> 18)) + hx(0x80 | ((c >> 12) & 63)) + hx(0x80 | ((c >> 6) & 63)) + hx(0x80 | (c & 63));
        }
    }
    return out;
}

function trim(s) {
    return String(s === undefined || s === null ? '' : s).replace(/^\s+|\s+$/g, '');
}

function corta(s, n) {
    s = trim(s).replace(/\s+/g, ' ');
    return s.length > n ? s.substring(0, n - 1) + '…' : s;
}

// Sem acento, minúsculas, só letras e números ("Almeida Corrigida-Fiel" = "almeida corrigida fiel").
function dobra(s) {
    var t = String(s || '').toLowerCase();
    var mapa = [[/[áàâãä]/g, 'a'], [/[éèêë]/g, 'e'], [/[íìîï]/g, 'i'], [/[óòôõö]/g, 'o'], [/[úùûü]/g, 'u'], [/ç/g, 'c'], [/ñ/g, 'n']];
    for (var i = 0; i < mapa.length; i++) {
        t = t.replace(mapa[i][0], mapa[i][1]);
    }
    return trim(t.replace(/[^a-z0-9]+/g, ' '));
}

function nomeTraducao(t) {
    t = trim(t);
    return TRADUCOES[t] ? t + ' · ' + TRADUCOES[t] : (t || 'sem nome');
}

function dataHora(ms) {
    var d = new Date(Number(ms));
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

// ---------- conversa com o avdp-consulta.exe ----------
// O Holyrics 2.30 entrega a saída do executeCmdAndWait com uma quebra de linha a mais a cada 8192
// caracteres (medido em 2026-10-18: 64000 → 64034, 7 a mais). O JSON do programa é uma linha só
// (quebras dentro do texto vêm como \n), então toda quebra que chega é tirada antes de ler.
// Por garantia, a resposta maior que `max_out` vem em pedaços (comando chunk), cada um conferido
// pelo tamanho; o limite é medido na primeira consulta e diminui sozinho se algo chegar errado.

var SEM_LIMITE = 100000000;
var PEDACO_PADRAO = 6000;

function nomeExe() {
    return trim(cfg('exe', EXE_PADRAO)) || EXE_PADRAO;
}

function maxOut() {
    var k = Number(module.getGlobal('max_out', 0));
    return k > 0 ? k : PEDACO_PADRAO;
}

// Roda o programa e devolve a saída como veio (texto) e a resposta do Holyrics.
function rodar(cli, timeout) {
    var exe = nomeExe();
    var r;
    try {
        r = module.executeCmdAndWait(exe, cli, timeout || 15000);
    } catch (e) {
        throw new Error('não deu para rodar o ' + exe + ' (' + (e && e.message ? e.message : e) + '). ' + dicaPermissao(exe));
    }
    var out = (r && r.data && r.data.output !== undefined && r.data.output !== null) ? String(r.data.output) : '';
    return { out: out, r: r };
}

function semResposta(x) {
    var exe = nomeExe();
    var why = [];
    if (x.r && x.r.error) { why.push(String(x.r.error)); }
    if (x.r && x.r.data && x.r.data.error) { why.push(trim(x.r.data.error)); }
    if (x.r && x.r.data && x.r.data.code !== undefined && x.r.data.code !== null) { why.push('código ' + x.r.data.code); }
    return new Error('o ' + exe + ' não respondeu' + (why.length ? ': ' + why.join(' · ') : '') + '. ' + dicaPermissao(exe));
}

// Saída do programa sem as quebras de linha que o Holyrics acrescenta.
function limpa(s) {
    return String(s === undefined || s === null ? '' : s).replace(/[\r\n]+/g, '');
}

function lerJson(s) {
    try {
        return JSON.parse(trim(limpa(s)));
    } catch (e) {
        return null;
    }
}

// Junta os pedaços de uma resposta grande; pedaço curto = cortado: diminui o pedaço e pede de novo.
function juntarPedacos(cab, timeout) {
    var total = Number(cab.size);
    var partes = [];
    var off = 0;
    var k = maxOut();
    var falhas = 0;
    while (off < total) {
        var len = Math.min(k, total - off);
        var x = rodar(['chunk', '--token', String(cab.token), '--offset', String(off), '--len', String(len)], timeout);
        var peca = limpa(x.out);
        if (peca.length === len && peca.charAt(0) !== '!') {
            partes.push(peca);
            off += len;
            continue;
        }
        falhas++;
        try { module.log('pedaço ' + off + '+' + len + ' chegou com ' + peca.length + ': ' + peca.substring(0, 80)); } catch (e) { /* sem log */ }
        if (peca.charAt(0) === '!' || falhas > 6) {
            throw new Error('a resposta grande do ' + nomeExe() + ' não chegou inteira (' + (peca.charAt(0) === '!' ? peca : peca.length + ' de ' + len + ' caracteres') + ')');
        }
        k = Math.max(300, Math.floor(Math.min(k, peca.length > 0 ? peca.length : k) * 0.7));
        module.setGlobal('max_out', k);
    }
    var j = lerJson(partes.join(''));
    if (!j) {
        throw new Error('a resposta em pedaços do ' + nomeExe() + ' veio inválida (' + total + ' caracteres)');
    }
    return j;
}

var TAMANHOS_TESTE = [64000, 32000, 16000, 8000, 4000, 2000];

// Uma resposta de `n` caracteres chega inteira? (comando eco)
function chegaInteira(n) {
    var x = rodar(['eco', '--bytes', String(n)], 15000);
    if (!trim(x.out)) {
        throw semResposta(x);
    }
    var j = lerJson(x.out);
    var quebras = String(x.out).replace(/[\r\n]+$/, '').split('\n').length - 1;
    return { ok: !!(j && j.pad && j.pad.length === n), recebido: trim(x.out).length, quebras: quebras };
}

// Na primeira consulta depois de abrir o Holyrics: mede o maior tamanho que chega inteiro.
function calibrar() {
    if (Number(module.getGlobal('max_out', 0)) > 0) {
        return;
    }
    for (var i = 0; i < TAMANHOS_TESTE.length; i++) {
        if (chegaInteira(TAMANHOS_TESTE[i]).ok) {
            module.setGlobal('max_out', Math.floor(TAMANHOS_TESTE[i] * 0.9));
            return;
        }
    }
    module.setGlobal('max_out', 1000);
}

// Roda um comando do avdp-consulta.exe e devolve o JSON (lança erro legível).
function consulta(cmd, args, timeout) {
    calibrar();
    var base = [cmd];
    var banco = trim(cfg('banco', ''));
    if (banco) {
        base.push('--db', hexUtf8(banco));
    }
    for (var i = 0; args && i < args.length; i++) {
        base.push(String(args[i]));
    }
    for (var tentativa = 0; tentativa < 4; tentativa++) {
        var k = maxOut();
        var x = rodar(base.concat(['--max-out', String(k)]), timeout);
        if (!trim(x.out)) {
            throw semResposta(x);
        }
        var j = lerJson(x.out);
        if (j === null) {
            // chegou cortada: o pedaço passa a ser menor que o que chegou, e tenta de novo
            var L = trim(limpa(x.out)).length;
            try { module.log('resposta inválida (' + L + ' caracteres, limite ' + k + '): ' + x.out.substring(0, 120) + ' … ' + x.out.substring(Math.max(0, x.out.length - 120))); } catch (e) { /* sem log */ }
            var novo = Math.floor(Math.min(L, k) * 0.7);
            if (L < 120 || novo < 300) {
                throw new Error('resposta inválida do ' + nomeExe() + ' (' + L + ' caracteres): ' + corta(x.out, 200));
            }
            module.setGlobal('max_out', novo);
            continue;
        }
        if (j.chunked) {
            j = juntarPedacos(j, timeout);
        }
        if (!j.ok) {
            throw new Error(j.error || 'erro desconhecido no ' + nomeExe());
        }
        return j;
    }
    throw new Error('a resposta do ' + nomeExe() + ' continua chegando cortada');
}

function dicaPermissao(exe) {
    try {
        if (!module.isAllowedFileToExecute(exe)) {
            return 'O arquivo não está liberado: na janela Módulos, AVDP Mensagens → permissões → allowed_files, marque ' + exe + ' (ele precisa estar na aba Arquivos da biblioteca).';
        }
    } catch (e) { /* versão sem o método */ }
    return 'Confira se o ' + exe + ' está na aba Arquivos da biblioteca e liberado nas permissões do módulo.';
}

function hlyOk(r, oque) {
    if (r && r.status && String(r.status) !== 'ok') {
        throw new Error(oque + ': ' + (r.error || r.status));
    }
    return r;
}

// ---------- projetar ----------

function temaFiltro() {
    var t = cfg('tema', null);
    if (!t) { return null; }
    if (typeof t === 'object') {
        if (t.id) { return { id: String(t.id) }; }
        if (t.name) { return { name: String(t.name) }; }
        return null;
    }
    return { id: String(t) };
}

function temaId() {
    var f = temaFiltro();
    return f && f.id ? f.id : null;
}

function esc(s) {
    return String(s).replace(/</g, '‹').replace(/>/g, '›');
}

function textoSlide(s, p, rodape) {
    if (!rodape) {
        return String(s.text);
    }
    var ref = p.code + (s.num > 0 ? ' · §' + s.num : '') + (s.parts > 1 ? ' (' + s.part + '/' + s.parts + ')' : '');
    return '<styled>' + esc(s.text) + '\n<size:55><i>' + esc(ref) + '</i></size>';
}

// Mensagem inteira na apresentação rápida, começando no slide do § escolhido.
function projetar(p) {
    var rodape = cfg('rodape', true) !== false && String(cfg('rodape', true)) !== 'false';
    var slides = [];
    var nums = [];
    for (var i = 0; i < p.slides.length; i++) {
        slides.push({ text: textoSlide(p.slides[i], p, rodape) });
        nums.push(p.slides[i].num);
    }
    if (!slides.length) {
        throw new Error('a mensagem não tem texto');
    }
    var input = { slides: slides, initial_index: Math.max(0, Math.min(p.start_slide, slides.length - 1)) };
    var tema = temaFiltro();
    if (tema) { input.theme = tema; }
    hlyOk(h.hly('ShowQuickPresentation', input), 'o Holyrics não projetou');
    module.setGlobal('em_projecao', {
        variant: p.variant, source: p.source, source_id: p.source_id, code: p.code, title: p.title,
        translation: p.translation, start_num: p.start_num, nums: nums, total: slides.length
    });
}

function mostrarDoItem(inp) {
    var args = [];
    if (trim(inp.source) && trim(inp.source_id)) {
        args.push('--src', hexUtf8(trim(inp.source)), '--src-id', hexUtf8(trim(inp.source_id)));
    }
    if (trim(inp.variant)) { args.push('--variant', trim(inp.variant)); }
    if (trim(inp.num)) { args.push('--num', trim(inp.num)); }
    if (!args.length) {
        throw new Error('item sem mensagem (refaça o item pela ação Adicionar à lista)');
    }
    args.push('--chars', String(caracteres()));
    projetar(consulta('paragraphs', args, 10000));
}

// ---------- lista de reprodução ----------

function nomeItem(p, num) {
    return p.code + ' ' + p.title + (num > 0 ? ' — §' + num : '') + ' [' + p.translation + ']';
}

// Item da lista para a mensagem a partir do slide `inicio`.
function itemDaMensagem(p, inicio) {
    var num = p.slides.length ? p.slides[inicio].num : 0;
    if (String(cfg('item_lista', ITEM_TEXTO)) !== ITEM_ACAO) {
        var partes = [];
        for (var i = inicio; i < p.slides.length; i++) {
            partes.push(String(p.slides[i].text));
        }
        var it = { type: 'plain_text', name: nomeItem(p, num), text: partes.join('\n\n') };
        var tema = temaId();
        if (tema) { it.theme = tema; }
        return it;
    }
    return {
        type: 'module_action',
        id: String(module.id),
        module_action_id: 'show_paragraph',
        inputs: { name: nomeItem(p, num), source: p.source, source_id: p.source_id, variant: String(p.variant), num: String(num) }
    };
}

function adicionar(itens, resumo) {
    hlyOk(h.hly('AddToPlaylist', { items: itens }), 'o Holyrics não adicionou');
    h.notification('Adicionado à lista: ' + resumo, 6);
}

// ---------- escolhas ----------

function escolherParagrafo(p) {
    var itens = [];
    for (var i = 0; i < p.slides.length; i++) {
        var s = p.slides[i];
        if (s.part !== 1) { continue; }
        itens.push({ label: (s.num > 0 ? '§' + s.num : 'início') + '  ' + corta(s.text, 110), slide: i, selected: i === p.start_slide });
    }
    var c = h.itemChooser(p.code + ' ' + p.title + ' — escolha o §', itens);
    if (!c) { return false; }
    p.start_slide = Number(c.slide);
    p.start_num = p.slides[p.start_slide].num;
    return true;
}

// Projetar ou adicionar à lista a mensagem `p` (já com o § escolhido).
function escolherAcao(p) {
    while (true) {
        var num = p.start_num > 0 ? '§' + p.start_num : 'o início';
        var ops = [
            { id: 'projetar', label: 'Projetar a partir de ' + num },
            { id: 'lista', label: 'Adicionar à lista a partir de ' + num },
            { id: 'lista_toda', label: 'Adicionar à lista a mensagem inteira' },
            { id: 'outro', label: 'Escolher outro §' }
        ];
        var c = h.itemChooser(p.code + ' ' + p.title + ' — ' + nomeTraducao(p.translation) + ' (' + p.para_count + ' §)', ops);
        if (!c) { return; }
        if (c.id === 'projetar') {
            projetar(p);
            return;
        }
        if (c.id === 'lista') {
            adicionar([itemDaMensagem(p, p.start_slide)], nomeItem(p, p.start_num));
            return;
        }
        if (c.id === 'lista_toda') {
            adicionar([itemDaMensagem(p, 0)], nomeItem(p, p.slides[0].num));
            return;
        }
        if (!escolherParagrafo(p)) { return; }
    }
}

function abrirVariante(v, num, escolherPar) {
    var args = ['--variant', String(v), '--chars', String(caracteres())];
    if (num) { args.push('--num', String(num)); }
    var p = consulta('paragraphs', args, 10000);
    if (escolherPar && !escolherParagrafo(p)) { return; }
    escolherAcao(p);
}

// Mensagem (grupo) → tradução → § → ação.
function abrirGrupo(g) {
    var vs = g.variants || [];
    if (!vs.length) {
        throw new Error(g.code + ' não tem texto no banco do plugin');
    }
    var v = vs[0];
    if (vs.length > 1) {
        var itens = [];
        for (var i = 0; i < vs.length; i++) {
            itens.push({ label: nomeTraducao(vs[i].translation) + ' — ' + (FONTES[vs[i].source] || vs[i].source) + ' · ' + vs[i].para_count + ' §' + (i === 0 ? '  (escolhida no AVDP)' : ''), v: vs[i] });
        }
        var c = h.itemChooser(g.code + ' ' + g.title + ' — tradução', itens);
        if (!c) { return; }
        v = c.v;
    }
    abrirVariante(v.id, null, true);
}

// ---------- ações ----------

function anos(txt) {
    var m = /^\s*(\d{4})\s*(?:[-–a]\s*(\d{4}))?\s*$/.exec(String(txt || ''));
    if (!m) { return null; }
    return { de: m[1], ate: m[2] || m[1] };
}

function acaoPesquisar() {
    var ult = module.getGlobal('pesquisa', {}) || {};
    var nomesModo = [];
    for (var i = 0; i < MODOS.length; i++) { nomesModo.push(MODOS[i][1]); }
    var r = h.inputV2([
        { id: 'texto', name: 'Procurar nas Mensagens', type: 'string', max_length: 300, default_value: ult.texto || '',
          description: 'Como no AVDP: "frase exata", -excluir, OU, prefixo*, parecida~, titulo:palavra. Código da data (65-1127B) abre a mensagem.' },
        { id: 'modo', name: 'Modo', type: 'string', allowed_values: nomesModo, default_value: ult.modo || MODOS[0][1] },
        { id: 'anos', name: 'Anos (ex.: 1963 ou 1960-1965; vazio = todos)', type: 'string', max_length: 20, default_value: ult.anos || '' },
        { id: 'palavra_inteira', name: 'Palavra inteira', type: 'boolean', default_value: !!ult.palavra_inteira },
        { id: 'variacoes', name: 'Incluir variações (amor, amores, amar…)', type: 'boolean', default_value: !!ult.variacoes },
        { id: 'aproximada', name: 'Incluir parecidas (erros de digitação)', type: 'boolean', default_value: !!ult.aproximada },
        { id: 'por_mensagem', name: 'Uma linha por mensagem', type: 'boolean', default_value: !!ult.por_mensagem }
    ]);
    if (!r) { return; }
    var texto = trim(r.texto);
    if (!texto) { return; }
    module.setGlobal('pesquisa', { texto: texto, modo: r.modo, anos: r.anos, palavra_inteira: r.palavra_inteira, variacoes: r.variacoes, aproximada: r.aproximada, por_mensagem: r.por_mensagem });

    var modo = 'all';
    for (var k = 0; k < MODOS.length; k++) {
        if (String(r.modo) === MODOS[k][1]) { modo = MODOS[k][0]; }
    }
    var limite = Math.round(Number(cfg('limite', 80))) || 80;
    var args = ['--q', hexUtf8(texto), '--mode', modo, '--limit', String(limite)];
    var a = anos(r.anos);
    if (trim(r.anos) && !a) {
        throw new Error('anos inválidos: use 1963 ou 1960-1965');
    }
    if (a) { args.push('--from', a.de, '--to', a.ate); }
    if (r.palavra_inteira) { args.push('--whole-word'); }
    if (r.variacoes) { args.push('--variants'); }
    if (r.aproximada) { args.push('--fuzzy'); }
    if (r.por_mensagem) { args.push('--by-message'); }
    var res = consulta('search', args, 20000);

    var itens = [];
    var direct = res.direct || [];
    for (var d = 0; d < direct.length; d++) {
        var g = direct[d];
        itens.push({ label: '≡ ' + g.code + ' ' + g.title + (g.local ? ' — ' + g.local : '') + (g.translations ? '  [' + g.translations + ']' : '  (sem texto)'), grupo: g.id, sem_texto: !g.translations });
    }
    var hits = res.hits || [];
    for (var j = 0; j < hits.length; j++) {
        var x = hits[j];
        var trecho = String(x.marked || '').replace(/⟦/g, '«').replace(/⟧/g, '»');
        itens.push({
            label: x.code + ' ' + corta(x.title, 50) + (x.num > 0 ? ' — §' + x.num : '') + ' [' + x.translation + ']' + (x.hits > 1 ? ' (' + x.hits + '×)' : '') + ': ' + corta(trecho, 150),
            variante: x.variant_id, seq: x.seq
        });
    }
    if (!itens.length) {
        h.notification('Nada encontrado para: ' + texto, 6);
        return;
    }
    var titulo = (res.total > hits.length ? res.total + ' resultados (mostrando ' + hits.length + ')' : res.total + ' resultado(s)') + ' — ' + corta(texto, 40);
    var c = h.itemChooser(titulo, itens);
    if (!c) { return; }
    if (c.grupo) {
        if (c.sem_texto) { throw new Error('esta mensagem não tem texto no banco do plugin'); }
        var gs = consulta('group', ['--id', String(c.grupo)]);
        if (!gs.groups || !gs.groups.length) { throw new Error('mensagem sem texto no banco do plugin'); }
        abrirGrupo(gs.groups[0]);
        return;
    }
    var p = consulta('paragraphs', ['--variant', String(c.variante), '--seq', String(c.seq), '--chars', String(caracteres())], 10000);
    escolherAcao(p);
}

function acaoAbrirPorData() {
    var ult = module.getGlobal('data', '') || '';
    var r = h.inputV2([
        { id: 'codigo', name: 'Código da data (ex.: 65-1127B) ou palavras do título', type: 'string', max_length: 120, default_value: ult }
    ]);
    if (!r || !trim(r.codigo)) { return; }
    var cod = trim(r.codigo);
    module.setGlobal('data', cod);
    var arg = /^\d{2,4}[-.\/ ]?\d{2}-?\d{2}\s*[A-Za-z]?$/.test(cod) ? '--code' : '--filter';
    var res = consulta('group', [arg, hexUtf8(cod)]);
    var gs = res.groups || [];
    if (!gs.length) {
        h.notification('Nenhuma mensagem com texto para: ' + cod + (res.without_text ? ' (' + res.without_text + ' sem texto no banco)' : ''), 6);
        return;
    }
    var g = gs[0];
    if (gs.length > 1) {
        var itens = [];
        for (var i = 0; i < gs.length; i++) {
            itens.push({ label: gs[i].code + ' ' + gs[i].title + (gs[i].local ? ' — ' + gs[i].local : ''), g: gs[i] });
        }
        var c = h.itemChooser('Mensagens — ' + cod, itens);
        if (!c) { return; }
        g = c.g;
    }
    abrirGrupo(g);
}

function texto(o) {
    try { return JSON.stringify(o); } catch (e) { return String(o); }
}

// Nº do slide (1…) da apresentação rápida na tela, se for a nossa (mesmo total de slides); 0 = não sei.
function slideAtual(total) {
    var fontes = [['GetCurrentPresentation', 'quick_presentation'], ['GetCurrentQuickPresentation', null]];
    for (var i = 0; i < fontes.length; i++) {
        try {
            var r = h.hly(fontes[i][0]);
            var d = r && r.data ? r.data : null;
            try { module.log(fontes[i][0] + ': ' + corta(texto(d), 300)); } catch (e1) { /* sem log */ }
            if (!d || (fontes[i][1] && String(d.type) !== fontes[i][1])) { continue; }
            var n = Number(d.slide_number);
            var t = Number(d.total_slides);
            if (n > 0 && (t === Number(total) || t === Number(total) + 1)) {
                return n;
            }
        } catch (e) { /* ação indisponível nesta versão */ }
    }
    return 0;
}

// A mensagem que está na tela (projetada por este módulo), a partir do § do slide atual.
function acaoAdicionarAtual() {
    var m = module.getGlobal('em_projecao', null);
    if (!m) {
        h.notification('Projete uma mensagem primeiro (Pesquisar mensagem ou Abrir por data).', 6);
        return;
    }
    var num = m.start_num;
    var slide = slideAtual(m.total);
    if (slide > 0 && slide <= m.nums.length) {
        num = m.nums[slide - 1];
    }
    var args = ['--chars', String(caracteres()), '--num', String(num), '--variant', String(m.variant)];
    if (m.source && m.source_id) { args.push('--src', hexUtf8(m.source), '--src-id', hexUtf8(m.source_id)); }
    var p = consulta('paragraphs', args, 10000);
    adicionar([itemDaMensagem(p, p.start_slide)], nomeItem(p, p.start_num));
}

// Chave da versão no Holyrics para a sigla/nome da Bíblia do AVDP (ACF → pt_acf…).
function versaoHolyrics(sigla, nome, versoes) {
    var ab = dobra(sigla);
    var nm = dobra(nome);
    if (!ab && !nm) { return null; }
    for (var i = 0; ab && i < versoes.length; i++) {
        var o = versoes[i];
        var cands = [dobra(o.version), dobra(o.key)];
        for (var j = 0; j < cands.length; j++) {
            var k = cands[j];
            if (!k) { continue; }
            var partes = k.split(' ');
            if (k === ab || partes[partes.length - 1] === ab || k.replace(/^[a-z]{2} /, '') === ab) {
                return String(o.version || o.key);
            }
        }
    }
    for (var n = 0; nm && n < versoes.length; n++) {
        var t = dobra(versoes[n].title);
        if (t && (t === nm || t.indexOf(nm) >= 0)) {
            return String(versoes[n].version || versoes[n].key);
        }
    }
    return null;
}

function acaoImportarFila() {
    var l = consulta('filas', []);
    var itens = [];
    var fs = l.files || [];
    for (var i = 0; i < fs.length; i++) {
        var f = fs[i];
        itens.push({ label: f.name + ' — ' + f.items + ' itens · de ' + f.from + ' · ' + dataHora(f.modified_ms) + '  (' + f.file + ')', path: f.path });
    }
    itens.push({ label: 'Outro arquivo… (digitar o caminho)', outro: true });
    var c = h.itemChooser('Importar fila do AVDP — escolha o arquivo', itens);
    if (!c) { return; }
    var caminho = c.path;
    if (c.outro) {
        var r = h.inputV2([{ id: 'caminho', name: 'Caminho do arquivo .avdpfila', type: 'string', max_length: 500 }]);
        if (!r || !trim(r.caminho)) { return; }
        caminho = trim(r.caminho).replace(/^"+|"+$/g, '');
    }
    var fila = consulta('fila', ['--file', hexUtf8(caminho), '--chars', String(caracteres())], 20000);

    var versoes = [];
    try {
        var vr = h.hly('GetBibleVersionsV2');
        versoes = (vr && vr.data) ? vr.data : [];
    } catch (e) { /* sem versões: vai a padrão */ }
    var comoTexto = String(cfg('item_lista', ITEM_TEXTO)) !== ITEM_ACAO;
    var add = [{ type: 'title', name: 'AVDP — ' + fila.name }];
    var rel = { musicas: 0, musicas_texto: [], versiculos: 0, sem_versao: [], mensagens: 0, textos: 0, fora: [] };
    var its = fila.items || [];
    for (var k = 0; k < its.length; k++) {
        var it = its[k];
        if (it.error) {
            rel.fora.push(it.label + ' (' + it.error + ')');
            continue;
        }
        if (it.kind === 'song') {
            var achou = null;
            try {
                var sr = h.hly('SearchLyrics', { text: it.title, title: true, artist: false, note: false, lyrics: false, fields: 'id,title,artist,archived' });
                var lista = (sr && sr.data) ? sr.data : [];
                var iguais = [];
                for (var s = 0; s < lista.length; s++) {
                    if (!lista[s].archived && dobra(lista[s].title) === dobra(it.title)) { iguais.push(lista[s]); }
                }
                for (var s2 = 0; s2 < iguais.length && !achou; s2++) {
                    if (it.artist && dobra(iguais[s2].artist) === dobra(it.artist)) { achou = iguais[s2]; }
                }
                if (!achou && iguais.length) { achou = iguais[0]; }
            } catch (e1) { /* sem busca: vai como texto */ }
            if (achou) {
                add.push({ type: 'song', id: String(achou.id) });
                rel.musicas++;
            } else {
                add.push({ type: 'plain_text', name: it.title, text: it.text });
                rel.musicas_texto.push(it.title);
            }
        } else if (it.kind === 'verse') {
            if (!it.ids || !it.ids.length) {
                rel.fora.push(it.label + ' (capítulo sem versículos no banco)');
                continue;
            }
            var v = versaoHolyrics(it.bible_abbrev, it.bible_name, versoes);
            var verso = { type: 'verse', ids: it.ids };
            if (v) { verso.version = v; } else { rel.sem_versao.push(it.label); }
            add.push(verso);
            rel.versiculos++;
        } else if (it.kind === 'message') {
            if (!comoTexto && it.found) {
                add.push({
                    type: 'module_action', id: String(module.id), module_action_id: 'show_paragraph',
                    inputs: { name: it.name + ' [' + it.translation + ']', source: it.source, source_id: it.source_id, variant: String(it.found.variant), num: String(it.num || '') }
                });
            } else {
                var pt = { type: 'plain_text', name: it.name + ' [' + it.translation + ']', text: it.text };
                var tema = temaId();
                if (tema) { pt.theme = tema; }
                add.push(pt);
            }
            rel.mensagens++;
        } else if (it.kind === 'text') {
            add.push({ type: 'plain_text', name: it.title, text: it.text });
            rel.textos++;
        } else {
            rel.fora.push(it.label + (it.kind === 'media' ? ' (mídia fica só no AVDP)' : ''));
        }
    }
    if (add.length === 1) {
        h.notification('A fila "' + fila.name + '" não tem itens para o Holyrics.', 6);
        return;
    }
    var destino = 'a programação aberta';
    try {
        var sc = h.hly('GetCurrentSchedule');
        var d0 = sc && sc.data ? (sc.data.length !== undefined ? sc.data[0] : sc.data) : null;
        if (d0 && (d0.name || d0.datetime)) { destino = '"' + trim((d0.name || 'sem nome') + ' ' + (d0.datetime || '')) + '"'; }
    } catch (e2) { /* fica o texto genérico */ }
    var resumo = [];
    if (rel.musicas) { resumo.push(rel.musicas + ' música(s) do Holyrics'); }
    if (rel.musicas_texto.length) { resumo.push(rel.musicas_texto.length + ' música(s) como texto'); }
    if (rel.versiculos) { resumo.push(rel.versiculos + ' versículo(s)'); }
    if (rel.mensagens) { resumo.push(rel.mensagens + ' mensagem(ns)'); }
    if (rel.textos) { resumo.push(rel.textos + ' texto(s)'); }
    var msg = 'Fila "' + fila.name + '" (de ' + fila.from + ') vai para o fim da lista de ' + destino + ':\n' + resumo.join(', ') + '.';
    if (rel.sem_versao.length) { msg += '\nSem a versão no Holyrics (vai a padrão): ' + rel.sem_versao.join('; ') + '.'; }
    if (rel.fora.length) { msg += '\nFicam de fora: ' + rel.fora.join('; ') + '.'; }
    if (!h.confirm(msg + '\n\nContinuar?', 'Importar fila do AVDP')) { return; }
    adicionar(add, fila.name + ' — ' + (add.length - 1) + ' itens');
}

// Abre o AVDP Busca em modo Holyrics (como a janela Bíblia do Holyrics): o avdp-consulta.exe
// inicia o programa solto e responde na hora; já aberto, o AVDP só volta para a frente.
function acaoAbrirAvdp() {
    var cli = ['abrir'];
    var caminho = trim(cfg('avdp', ''));
    if (caminho) {
        cli.push('--exe', hexUtf8(caminho));
    }
    var x = rodar(cli, 5000);
    if (!trim(x.out)) {
        throw semResposta(x);
    }
    var j = lerJson(x.out);
    if (!j || !j.ok) {
        throw new Error(j && j.error ? j.error : 'resposta inválida do ' + nomeExe() + ': ' + corta(x.out, 200));
    }
}

// O avdp-consulta.exe lê no banco do AVDP o tema das letras e o papel de parede, copia as imagens
// para a aba Imagens (pasta AVDP) e devolve o tema no formato do Holyrics; o tema abre no editor do
// Holyrics para conferir e salvar. O papel de parede só troca a imagem (ligar/desligar segue no F8).
function acaoAplicarVisual() {
    var x = rodar(['visual'], 15000);
    if (!trim(x.out)) {
        throw semResposta(x);
    }
    var j = lerJson(x.out);
    if (!j || !j.ok) {
        throw new Error(j && j.error ? j.error : 'resposta inválida do ' + nomeExe() + ': ' + corta(x.out, 200));
    }
    var feito = '';
    if (j.wallpaper) {
        hlyOk(h.hly('SetWallpaperSettings', { file: j.wallpaper, adjust_type: 'FILL' }), 'o Holyrics não trocou o papel de parede');
        feito = '; papel de parede: ' + j.wallpaper + ' (F8)';
    }
    h.popupCreateTheme(j.theme, function (id) {
        h.notification('AVDP: ' + (id ? 'tema "' + j.theme.name + '" criado' : 'tema não salvo') + feito, 10);
    });
}

function acaoConferir() {
    // mede de novo o tamanho que chega inteiro
    var medidas = [];
    var melhor = 0;
    for (var t = 0; t < TAMANHOS_TESTE.length; t++) {
        var m = chegaInteira(TAMANHOS_TESTE[t]);
        medidas.push(TAMANHOS_TESTE[t] + (m.ok ? ' ok' : ' errada (' + m.recebido + ')') + (m.quebras ? ' +' + m.quebras + ' quebras' : ''));
        if (m.ok && TAMANHOS_TESTE[t] > melhor) { melhor = TAMANHOS_TESTE[t]; }
    }
    module.setGlobal('max_out', melhor ? Math.floor(melhor * 0.9) : 1000);
    var r = consulta('info', []);
    var trad = [];
    for (var i = 0; r.translations && i < r.translations.length && i < 6; i++) {
        trad.push(r.translations[i][0] + ' ' + r.translations[i][1]);
    }
    var feito = r.meta && r.meta.made_at ? dataHora(Number(r.meta.made_at) * 1000) : '?';
    var texto = 'Programa: avdp-consulta ' + r.version + ' (OK)\nBanco: ' + r.db + '\nGerado em: ' + feito
        + '\nMensagens com texto: ' + r.with_text + ' de ' + r.groups + ' · ' + r.paragraphs + ' parágrafos'
        + '\nAnos: ' + r.year_min + '–' + r.year_max + '\nTraduções: ' + trad.join(', ')
        + '\nRespostas do programa: ' + medidas.join(', ') + '\nPedaço em uso: ' + maxOut() + ' caracteres';
    try { module.log(texto.replace(/\n/g, ' | ')); } catch (e) { /* sem log */ }
    h.confirm(texto, 'AVDP Mensagens');
}
