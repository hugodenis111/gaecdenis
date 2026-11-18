/* Ferme Denis — appli famille (AGRIOS) — version 4.2
 * Lecture des données de la ferme + discussion avec l'IA + ajout d'infos confirmées.
 * Toutes les données passent par la fonction Supabase public.famille_lire (membres de la famille seulement).
 */
(function () {
  'use strict';

  const C = window.AGRIOS_CONFIG;
  const sb = window.supabase.createClient(C.supabaseUrl, C.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
  });

  // =====================================================================
  // Outils
  // =====================================================================
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = (v, d = 0) => (v === null || v === undefined || v === '' || isNaN(Number(v)))
    ? '—' : Number(v).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const dateFr = (d, court) => {
    if (!d) return 'date inconnue';
    const x = new Date(String(d).length === 10 ? d + 'T12:00:00' : d);
    if (isNaN(x)) return String(d);
    return x.toLocaleDateString('fr-FR', court ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
  };
  // Jours entiers depuis une date (de minuit à minuit, heure du téléphone) : même résultat le matin et le soir
  const joursDepuis = (d) => { const a = new Date(String(d).slice(0, 10) + 'T00:00:00'); const b = new Date(); b.setHours(0, 0, 0, 0); return Math.round((b - a) / 86400000); };
  const BATIMENTS = { 'gaec-denis-p01': 'Poulailler 1', 'gaec-denis-p02': 'Poulailler 2', 'gaec-denis-futur': 'Futur bâtiment', 'gaec-denis-hangar-kernevez': 'Hangar de Kernevez' };
  const batNom = (b) => BATIMENTS[b] || String(b || '—').replace('gaec-denis-', '').toUpperCase();
  const age = (m) => {
    if (m === null || m === undefined) return '—';
    if (m < 24) return m + ' mois';
    const a = Math.floor(m / 12), r = m % 12;
    return a + ' ans' + (r ? ' ' + r + ' mois' : '');
  };
  const sexe = (s) => (s === 'F' ? 'Femelle' : s === 'M' ? 'Mâle' : '—');
  const surfaceTexte = (m2) => (m2 === null || m2 === undefined) ? '' : (m2 >= 5000 ? nf(m2 / 10000, 2) + ' ha' : nf(m2, 0) + ' m²');
  const pluriel = (n, mot, motPluriel) => nf(n) + ' ' + (Number(n) > 1 ? (motPluriel || (/eau$/.test(mot) ? mot + 'x' : mot + 's')) : mot);
  const majuscule = (t) => { const x = String(t || ''); return x.charAt(0).toUpperCase() + x.slice(1); };
  const icone = (nom, extra) => `<span class="ms${extra ? ' ' + extra : ''}">${nom}</span>`;

  const COULEURS_CULTURES = {
    TTH: '#e0a030', CZH: '#f2d22e', AVH: '#d98b4a', SGH: '#a0703c', MIS: '#e8c35a', MLG: '#4bb3a6',
    PPH: '#2e7d32', PTR: '#7cc36b', PRL: '#5aa05a', RGA: '#a5d64c', SNE: '#9e9e9e', SRS: '#9c6fb8'
  };
  const couleurCulture = (code) => COULEURS_CULTURES[code] || '#34c759';
  const pastilleCulture = (code) => `<span class="pastille" style="background:${couleurCulture(code)}"></span>`;

  // =====================================================================
  // Données
  // =====================================================================
  // Hors réseau : la dernière réponse de chaque lecture est gardée sur le téléphone (cache du navigateur)
  // et resservie, avec un bandeau, quand il n'y a pas de réseau (étable, champs). Effacée à la déconnexion.
  const CACHE_DONNEES = 'ferme-denis-donnees-v1';
  const urlDonnee = (cle) => new URL('__donnees/' + encodeURIComponent(cle), location.href).href;
  const estErreurReseau = (e) => !navigator.onLine || /Failed to fetch|NetworkError|network|Load failed|fetch failed/i.test(String((e && (e.message || e.msg)) || e));
  async function garderDonnee(cle, data) {
    try {
      const c = await caches.open(CACHE_DONNEES);
      await c.put(urlDonnee(cle), new Response(JSON.stringify({ le: Date.now(), data }), { headers: { 'Content-Type': 'application/json' } }));
    } catch (e) { /* stockage indisponible : tant pis, on lira en ligne */ }
  }
  async function relireDonnee(cle) {
    try { const c = await caches.open(CACHE_DONNEES); const r = await c.match(urlDonnee(cle)); return r ? await r.json() : null; } catch (e) { return null; }
  }
  async function effacerDonneesGardees() { try { await caches.delete(CACHE_DONNEES); } catch (e) { /* rien à effacer */ } }
  let horsLigneDepuis = null; // date de la plus ancienne donnée resservie sans réseau
  function majBandeau() {
    const b = $('#bandeau-reseau');
    if (!b) return;
    const attente = lireFile().length;
    const morceaux = [];
    if (horsLigneDepuis) morceaux.push(`Pas de réseau : tu vois les données gardées sur le téléphone (du ${new Date(horsLigneDepuis).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}).`);
    if (attente) morceaux.push(`${pluriel(attente, 'info notée', 'infos notées')} sans réseau, ${attente > 1 ? 'envoyées' : 'envoyée'} dès que le réseau revient.`);
    b.hidden = !morceaux.length;
    $('.txt', b).textContent = morceaux.join(' ');
    // Le contenu descend de la hauteur du bandeau pour ne rien cacher
    document.documentElement.style.setProperty('--bandeau', b.hidden ? '0px' : b.offsetHeight + 'px');
  }
  const cache = {};
  async function lire(quoi, params = {}) {
    const cle = quoi + JSON.stringify(params);
    if (cache[cle]) return cache[cle];
    const secours = async (error) => {
      if (estErreurReseau(error)) {
        const g = await relireDonnee(cle);
        if (g) { horsLigneDepuis = Math.min(horsLigneDepuis || Infinity, g.le); majBandeau(); return g.data; }
      }
      delete cache[cle];
      throw error;
    };
    const promesse = sb.rpc('famille_lire', { p_quoi: quoi, p_params: params }).then(({ data, error }) => {
      if (error) return secours(error);
      garderDonnee(cle, data);
      return data;
    }, secours);
    cache[cle] = promesse;
    return promesse;
  }

  // Infos notées sans réseau : gardées sur le téléphone puis envoyées dès que le réseau revient
  const CLE_A_ENVOYER = 'ferme-denis-a-envoyer-v1';
  function lireFile() { try { return JSON.parse(localStorage.getItem(CLE_A_ENVOYER) || '[]'); } catch (e) { return []; } }
  function ecrireFile(l) { try { if (l.length) localStorage.setItem(CLE_A_ENVOYER, JSON.stringify(l)); else localStorage.removeItem(CLE_A_ENVOYER); } catch (e) { /* stockage plein */ } }
  function mettreEnAttente(p) { const l = lireFile(); l.push({ p, le: Date.now() }); ecrireFile(l); majBandeau(); }
  let envoiEnCours = false;
  async function envoyerEnAttente() {
    const l = lireFile();
    if (envoiEnCours || !l.length || !navigator.onLine) return;
    envoiEnCours = true;
    const restants = [];
    for (const x of l) {
      try {
        const { error } = await sb.rpc('famille_ajouter', { p_donnees: x.p });
        if (error) restants.push(x);
      } catch (e) { restants.push(x); }
    }
    ecrireFile(restants);
    envoiEnCours = false;
    if (restants.length < l.length) viderCache();
    majBandeau();
  }
  // Le réseau revient : on envoie ce qui attend, et on recharge la page si elle montrait des données gardées
  window.addEventListener('online', () => {
    envoyerEnAttente();
    if (horsLigneDepuis) { horsLigneDepuis = null; viderCache(); majBandeau(); if (vueCourante) afficher(vueCourante); }
  });
  const viderCache = () => Object.keys(cache).forEach((k) => delete cache[k]);
  function prechargement() {
    return Promise.allSettled(['accueil', 'vaches', 'lots', 'champs', 'troupeau'].map((q) => lire(q)));
  }

  function messageErreur(e) {
    const m = (e && (e.message || e.msg || e.error_description)) || String(e);
    if (/acces_refuse/.test(m)) return "Ton compte n'est pas encore autorisé. Demande à Hugo de t'ajouter.";
    if (/JWT|token|session/i.test(m)) return 'Ta connexion a expiré. Va dans « Plus » puis « Se déconnecter », et reconnecte-toi.';
    if (/Failed to fetch|NetworkError|network|Load failed/i.test(m)) return "Pas de réseau pour l'instant. Réessaie quand tu as du réseau.";
    return 'Un problème est survenu : ' + m;
  }

  let minuteurChargement = null;
  function chargement(oui) {
    clearTimeout(minuteurChargement);
    if (oui) minuteurChargement = setTimeout(() => { $('#chargement').hidden = false; }, 300);
    else $('#chargement').hidden = true;
  }

  // =====================================================================
  // Navigation
  // =====================================================================
  const contenu = $('#contenu');
  let pile = [];
  let vueCourante = null;

  let numeroVue = 0;
  // Titre posé par une page après chargement : seulement si elle est encore affichée
  const titrePage = (el, t) => { if (el.isConnected) $('#titre-page').textContent = t; };
  async function afficher(vue) {
    const numero = ++numeroVue;
    vueCourante = vue;
    $('#titre-page').textContent = vue.titre;
    $('#bouton-retour').hidden = pile.length === 0;
    const estCarte = vue.carte === true;
    $('#vue-carte').hidden = !estCarte;
    contenu.hidden = estCarte;
    $('#barre-saisie').hidden = vue.discuter !== true;
    contenu.classList.toggle('mode-discussion', vue.discuter === true);
    // Chaque page écrit dans sa propre zone : si on change de page pendant un chargement lent,
    // l'ancienne page écrit dans une zone déjà retirée et ne remplace pas la nouvelle.
    let zone = contenu;
    if (!estCarte) { contenu.innerHTML = ''; window.scrollTo(0, 0); zone = contenu.appendChild(document.createElement('div')); }
    chargement(true);
    try {
      await vue.rendu(zone);
    } catch (e) {
      if (numero !== numeroVue) return;
      console.error(e);
      if (estCarte) { contenu.hidden = false; $('#vue-carte').hidden = true; }
      contenu.innerHTML = `<div class="bloc alerte"><h2>${icone('error')}Oups</h2><p>${esc(messageErreur(e))}</p>
        <button class="bouton-principal" id="reessayer">${icone('refresh')}Réessayer</button></div>`;
      $('#reessayer').onclick = () => { viderCache(); afficher(vue); };
    } finally {
      if (numero === numeroVue) chargement(false);
    }
  }

  const ONGLET_DE_VUE = { accueil: 'accueil', vaches: 'vaches', volailles: 'volailles', champs: 'carte', carte: 'carte', discuter: 'discuter', plus: 'plus' };

  function allerOnglet(nom, options) {
    pile = [];
    const onglet = ONGLET_DE_VUE[nom] || nom;
    $$('.onglet').forEach((b) => b.classList.toggle('actif', b.dataset.onglet === onglet));
    const vues = {
      accueil: { titre: 'Ferme Denis', rendu: vueAccueil },
      vaches: { titre: 'Troupeau', rendu: (el) => vueVaches(el, options || {}) },
      volailles: { titre: 'Volailles', rendu: vueVolailles },
      champs: { titre: 'Champs', rendu: (el) => vueChamps(el, options || {}) },
      carte: { titre: 'Carte de la ferme', rendu: () => vueCarte(options || {}), carte: true },
      discuter: { titre: 'Discuter', rendu: (el) => vueDiscuter(el, options || {}), discuter: true },
      plus: { titre: 'Plus', rendu: vuePlus }
    };
    afficher(vues[nom]);
  }

  function ouvrir(titre, rendu) {
    pile.push(vueCourante);
    history.pushState({ niveau: pile.length }, '');
    afficher({ titre, rendu });
  }
  window.addEventListener('popstate', () => { if (pile.length) afficher(pile.pop()); });
  $('#bouton-retour').addEventListener('click', () => history.back());
  $$('.onglet').forEach((b) => b.addEventListener('click', () => allerOnglet(b.dataset.onglet)));
  $('#bouton-actualiser').addEventListener('click', () => { viderCache(); meteoCache = null; if (vueCourante) afficher(vueCourante); });
  $('#bouton-chercher').addEventListener('click', () => { if (vueCourante && vueCourante.titre === 'Chercher') { const c = $('#champ-chercher'); if (c) c.focus(); } else ouvrirRecherche(); });

  // Petits morceaux d'interface
  const chiffre = (v, libelle, d) => `<div class="chiffre"><b>${nf(v, d || 0)}</b><span>${esc(libelle)}</span></div>`;
  const ligne = (g, d) => `<div class="ligne"><div class="g">${g}</div><div class="d">${d}</div></div>`;
  // Pages qui s'ouvrent par-dessus un onglet (bouton retour)
  const PAGES = {
    sci: ['SCI', (el) => vueSci(el)], documents: ['Documents', (el) => vueDocuments(el)], batiments: ['Bâtiments', (el) => vueBatiments(el)],
    taches: ['Travail des assistants', (el) => vueTaches(el)], journal: ['Journal des ateliers', (el) => vueJournal(el)], ajouts: ['Infos de la famille', (el) => vueAjouts(el)],
    sources: ['Nos sources', (el) => vueSources(el)], a_faire: ['À faire', (el) => vueAFaire(el)]
  };
  const brancher = (el) => {
    $$('[data-aller]', el).forEach((bt) => bt.addEventListener('click', () => allerOnglet(bt.dataset.aller, bt.dataset.options ? JSON.parse(bt.dataset.options) : undefined)));
    $$('[data-ouvrir]', el).forEach((bt) => bt.addEventListener('click', () => { const p = PAGES[bt.dataset.ouvrir]; if (p) ouvrir(p[0], p[1]); }));
    $$('[data-noter]', el).forEach((bt) => bt.addEventListener('click', () => noter(bt.dataset.noter ? JSON.parse(bt.dataset.noter) : {})));
  };
  // Ouvre le formulaire « Noter une info » puis rafraîchit la page en dessous si on y est encore
  const noter = (o) => { const vue = vueCourante; formulaireInfo(o, () => { if (vueCourante === vue) afficher(vue); }); };

  // =====================================================================
  // Météo (Open-Meteo, gratuit, sans clé) — Berrien
  // =====================================================================
  let meteoCache = null;
  const METEO = {
    0: ['Ciel clair', 'sunny'], 1: ['Plutôt dégagé', 'partly_cloudy_day'], 2: ['Partiellement nuageux', 'partly_cloudy_day'], 3: ['Couvert', 'cloud'],
    45: ['Brouillard', 'foggy'], 48: ['Brouillard givrant', 'foggy'], 51: ['Bruine légère', 'rainy_light'], 53: ['Bruine', 'rainy_light'], 55: ['Bruine forte', 'rainy'],
    56: ['Bruine verglaçante', 'weather_mix'], 57: ['Bruine verglaçante', 'weather_mix'], 61: ['Pluie faible', 'rainy_light'], 63: ['Pluie', 'rainy'], 65: ['Forte pluie', 'rainy_heavy'],
    66: ['Pluie verglaçante', 'weather_mix'], 67: ['Pluie verglaçante', 'weather_mix'], 71: ['Neige faible', 'weather_snowy'], 73: ['Neige', 'weather_snowy'], 75: ['Forte neige', 'weather_snowy'],
    77: ['Grésil', 'weather_snowy'], 80: ['Averses', 'rainy'], 81: ['Averses', 'rainy'], 82: ['Fortes averses', 'rainy_heavy'], 85: ['Averses de neige', 'weather_snowy'],
    86: ['Averses de neige', 'weather_snowy'], 95: ['Orage', 'thunderstorm'], 96: ['Orage et grêle', 'thunderstorm'], 99: ['Orage et grêle', 'thunderstorm']
  };
  async function chargerMeteo() {
    if (meteoCache && Date.now() - meteoCache.t < 30 * 60 * 1000) return meteoCache.d;
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=48.41&longitude=-3.77'
      + '&current=temperature_2m,weather_code,wind_speed_10m,precipitation'
      + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum'
      + '&timezone=Europe%2FParis&forecast_days=3';
    const r = await fetch(url);
    if (!r.ok) throw new Error('meteo');
    const d = await r.json();
    meteoCache = { t: Date.now(), d };
    return d;
  }
  async function blocMeteo(conteneur) {
    try {
      const d = await chargerMeteo();
      const c = d.current || {}, j = d.daily || {};
      const m = METEO[c.weather_code] || ['', 'thermostat'];
      const jours = (j.time || []).map((t, i) => {
        const mm = METEO[j.weather_code[i]] || ['', 'thermostat'];
        const nom = i === 0 ? "Aujourd'hui" : i === 1 ? 'Demain' : new Date(t + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long' });
        return `<div class="jour-meteo">${icone(mm[1])}<b>${esc(nom.charAt(0).toUpperCase() + nom.slice(1))}</b>
          <span>${nf(j.temperature_2m_min[i])}° / ${nf(j.temperature_2m_max[i])}°</span><span class="pluie">${icone('water_drop')}${nf(j.precipitation_sum[i], 1)} mm</span></div>`;
      }).join('');
      // Une seule ligne ; on la touche pour voir les 3 jours
      const pluie = (i) => { const v = j.precipitation_sum ? j.precipitation_sum[i] : null; return v == null ? '—' : nf(v, v >= 10 || v === 0 ? 0 : 1) + ' mm'; };
      conteneur.innerHTML = `<button class="meteo-ligne" aria-expanded="false" aria-controls="jours-meteo">
          ${icone(m[1])}<b>${nf(c.temperature_2m)}°</b>
          <span class="txt"><span class="l1">${esc(m[0])} · vent ${nf(c.wind_speed_10m)} km/h</span><span class="doux l2">Pluie ${pluie(0)}, demain ${pluie(1)}</span></span>${icone('expand_more', 'fleche')}</button>
        <div class="jours-meteo" id="jours-meteo" hidden>${jours}</div>`;
      const bouton = $('.meteo-ligne', conteneur);
      bouton.addEventListener('click', () => {
        const ouvert = bouton.getAttribute('aria-expanded') === 'true';
        bouton.setAttribute('aria-expanded', ouvert ? 'false' : 'true');
        $('#jours-meteo', conteneur).hidden = ouvert;
      });
    } catch (e) {
      conteneur.innerHTML = '';
    }
  }

  // =====================================================================
  // Accueil
  // =====================================================================
  function dureeHabituelle(tousLots, production) {
    const ages = tousLots.filter((x) => x.production === production && x.age_moyen_j != null).slice(0, 10).map((x) => Number(x.age_moyen_j));
    return ages.length ? Math.round(ages.reduce((s, v) => s + v, 0) / ages.length) : null;
  }
  function lotsEnCours(tousLots) {
    return tousLots.filter((l) => l.poids_moyen_kg == null && l.date_fin == null && l.date_mep && joursDepuis(l.date_mep) <= 120)
      .map((l) => Object.assign({}, l, { age_j: joursDepuis(l.date_mep) }))
      .sort((a, b) => String(a.batiment).localeCompare(String(b.batiment)));
  }
  // Bilan provisoire : chiffres tirés du seul bilan technique de Maestro, sans bilan éleveur (l'argent) pour l'instant
  const bilanProvisoire = (l) => l.poids_moyen_kg != null && /maestro/.test(String(l.statut_mesures || '')) && !/bilan_eleveur/.test(String(l.statut_mesures || ''));
  // Âges habituels à l'enlèvement (10 derniers lots finis de la même production) : femelles d'abord, mâles en dernier
  function agesHabituels(tousLots, production) {
    const r = tousLots.filter((x) => x.production === production && x.age_moyen_j != null).slice(0, 10);
    const moy = (k, liste) => { const v = (liste || r).map((x) => x[k]).filter((v) => v != null).map(Number); return v.length ? Math.round(v.reduce((s, a) => s + a, 0) / v.length) : null; };
    // Les 3 départs habituels (2 de femelles, 1 de mâles) : derniers lots qui ont eu 3 départs
    const a3 = tousLots.filter((x) => x.production === production && Number(x.nb_departs) === 3 && x.depart_3_age_j != null).slice(0, 10);
    const departs = a3.length >= 3 ? [moy('depart_1_age_j', a3), moy('depart_2_age_j', a3), moy('depart_3_age_j', a3)] : null;
    return { moyen: moy('age_moyen_j'), femelles: moy('age_femelle_j'), males: moy('age_male_j'), departs, nbLots: a3.length };
  }
  const datePlusJours = (iso, j) => { const d = new Date(String(iso).slice(0, 10) + 'T12:00:00'); d.setDate(d.getDate() + j); return dateFr(d.toISOString().slice(0, 10), true); };
  function ligneLotEnCours(l, tousLots, attr) {
    const a = agesHabituels(tousLots, l.production);
    const duree = (a.departs && a.departs[2]) || a.males || a.moyen;
    const pct = duree ? Math.min(100, Math.round((Number(l.age_j) / duree) * 100)) : null;
    const reste = duree ? duree - Number(l.age_j) : null;
    const enlevement = !l.date_mep || reste === null ? ''
      : reste <= 0 ? ` · date estimée du dernier départ passée (≈ ${datePlusJours(l.date_mep, duree)}) : départs pas encore relevés`
      : a.departs ? ` · départs ≈ ${datePlusJours(l.date_mep, a.departs[0])} et ${datePlusJours(l.date_mep, a.departs[1])} (femelles), ${datePlusJours(l.date_mep, a.departs[2])} (mâles)`
      : a.males && a.femelles ? ` · enlèvement ≈ ${datePlusJours(l.date_mep, a.femelles)} (femelles) et ${datePlusJours(l.date_mep, a.males)} (mâles)`
      : ` · enlèvement dans ~${reste} jours`;
    return `<button class="alerte-ligne info" ${attr || ''}>
      ${icone('egg_alt')}
      <span class="txt"><b>${esc(batNom(l.batiment))} · jour ${nf(l.age_j)}</b>
        <span>${esc(l.production || '')}${esc(enlevement)}</span>
        ${pct !== null ? `<span class="progression" aria-label="${pct} % du lot"><i style="width:${pct}%"></i></span>` : ''}</span>
    </button>`;
  }

  async function vueAccueil(el) {
    const [a, tousLots, toutesBetes] = await Promise.all([lire('accueil'), lire('lots'), lire('vaches').catch(() => [])]);
    prechargement();
    const b = a.bovins || {};
    // Mêmes groupes que l'onglet Troupeau (vaches, génisses d'1 an et +, veaux, mâles d'1 an et +)
    const compteGroupe = (id) => toutesBetes.filter(FILTRES_VACHES.find((f) => f.id === id).test).length;
    const groupesTroupeau = toutesBetes.length ? FILTRES_VACHES.filter((f) => f.id !== 'toutes') : [];
    const lots = a.lots_en_cours || [];
    const cultures = a.cultures || [];
    const totalHa = cultures.reduce((s, c) => s + Number(c.ha || 0), 0);
    const maj = a.mises_a_jour || {};
    const nomsAteliers = { volailles: 'Volailles', bovins: 'Troupeau', cultures: 'Champs', porcs: 'Porcs', batiments: 'Bâtiments' };
    const aujourdhui = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    const ajouts = a.ajouts_recents || [];
    const heure = new Date().getHours();
    const salut = heure < 5 || heure >= 18 ? 'Bonsoir' : 'Bonjour';
    const dateInventaire = b.inventaire_le || INVENTAIRE_EDE;
    // Dernière vérification à l'EDE (même si rien n'a changé depuis l'inventaire chargé)
    const dateVerifEde = b.inventaire_verifie_le && b.inventaire_verifie_le > dateInventaire ? b.inventaire_verifie_le : dateInventaire;
    const joursInventaire = joursDepuis(dateVerifEde);

    let bienvenueVue = false;
    try { bienvenueVue = localStorage.getItem(CLE_BIENVENUE) === '1'; } catch (e) { /* stockage indisponible */ }
    const dernierLotFini = tousLots.filter((x) => x.poids_moyen_kg != null && x.date_mep).sort((x, y) => (x.date_mep < y.date_mep ? 1 : -1))[0];

    el.innerHTML = `
      <div class="salut"><b>${salut} ${esc(a.nom)}</b><span>${esc(aujourdhui.charAt(0).toUpperCase() + aujourdhui.slice(1))}</span></div>
      <div id="zone-meteo"></div>
      <div class="actions-rapides">
        <button class="action-rapide principale" data-noter="">${icone('edit_note')}<span>Noter une info</span></button>
        <button class="action-rapide" id="accueil-chercher">${icone('search')}<span>Chercher<br><span class="petit-texte">bête, champ, papier…</span></span></button>
      </div>
      ${bienvenueVue ? '' : `<div class="bloc bienvenue">
        <button class="fermer-bienvenue" aria-label="Fermer">${icone('close')}</button>
        <h2>Bienvenue dans l'appli de la ferme</h2>
        <p>Tout ce qu'on sait de la ferme est réuni ici : le troupeau, les lots, les champs, la SCI et les papiers. Trois choses à essayer :</p>
        <div class="essais">
          <button data-essai="chercher">${icone('search')}<span><b>Retrouver une info</b><span>Un numéro de bête, un champ, un papier…</span></span></button>
          ${dernierLotFini ? `<button data-essai="lot">${icone('egg_alt')}<span><b>Voir le dernier lot</b><span>Comparé aux lots d'avant</span></span></button>` : ''}
          <button data-essai="ia">${icone('mic')}<span><b>Demander à l'IA</b><span>En écrivant ou en parlant au micro</span></span></button>
        </div>
      </div>`}
      <div id="zone-attente"></div>

      <div class="bloc">
        <h2>${icone('notifications')}À surveiller</h2>
        <div class="fil-alertes">
          ${lotsEnCours(tousLots).map((l) => ligneLotEnCours(l, tousLots, `data-lot-accueil="${esc(l.lot_id)}"`)).join('')}
          ${joursInventaire > 14 ? `<button class="alerte-ligne info" data-aller="vaches">${icone('history')}
             <span class="txt"><b>Troupeau : dernier contrôle EDE le ${esc(dateFr(dateVerifEde))}</b><span>Il y a ${nf(joursInventaire)} jours. Les naissances et sorties déclarées depuis n'y sont pas encore : il faut un nouveau contrôle EDE.</span></span></button>` : ''}
          ${ajouts.length ? `<button class="alerte-ligne attention" data-ouvrir="ajouts">${icone('edit_note')}
             <span class="txt"><b>${pluriel(ajouts.length, 'info ajoutée', 'infos ajoutées')} par la famille</b><span>Dernière : ${esc(ajouts[0].resume)} (${esc(ajouts[0].auteur)})</span></span></button>` : ''}
          ${!lots.length && !ajouts.length && joursInventaire <= 14 ? `<div class="alerte-ligne info rien">${icone('check_circle')}<span class="txt"><b>Rien de particulier</b><span>Pas de lot en cours ni d'info nouvelle.</span></span></div>` : ''}
        </div>
      </div>

      <div id="zone-a-faire"></div>

      <div class="raccourcis">
        <button class="raccourci" data-aller="vaches">${icone('pets')}<b>Troupeau</b><span>${nf(b.total)} bêtes</span></button>
        <button class="raccourci" data-aller="volailles">${icone('egg_alt')}<b>Volailles</b><span>${lots.length ? pluriel(lots.length, 'lot') + ' en cours' : 'pas de lot en cours'}</span></button>
        <button class="raccourci" data-aller="champs">${icone('grass')}<b>Champs</b><span>${nf(totalHa, 0)} ha PAC</span></button>
        <button class="raccourci" data-aller="carte">${icone('map')}<b>Carte</b><span>de la ferme</span></button>
        <button class="raccourci" data-ouvrir="sci">${icone('real_estate_agent')}<b>SCI</b><span>les maisons</span></button>
        <button class="raccourci" data-ouvrir="documents">${icone('folder_open')}<b>Papiers</b><span>photos, PDF</span></button>
      </div>

      <div class="bloc">
        <h2>${icone('pets')}Troupeau <span class="doux h2-doux">· ${nf(b.total)} bêtes</span></h2>
        <div class="chiffres${groupesTroupeau.length ? ' quatre' : ''}">
          ${groupesTroupeau.length ? groupesTroupeau.map((f) => `<button class="chiffre chiffre-bouton" data-aller="vaches" data-options='{"filtre":"${f.id}"}'><b>${nf(compteGroupe(f.id))}</b><span>${esc(LIBELLES_COURTS[f.id] || f.libelle)}</span></button>`).join('')
            : chiffre(b.vaches, 'Vaches') + chiffre(b.total, 'bovins en tout')}
        </div>
        <p class="note" style="margin-bottom:0">Inventaire EDE du ${esc(dateFr(dateInventaire))}${dateVerifEde !== dateInventaire ? `, vérifié le ${esc(dateFr(dateVerifEde))}` : ''}. Génisses et mâles : 1 an et plus ; veaux : moins d'1 an. Touche un chiffre pour voir les bêtes.</p>
      </div>

      ${cultures.length ? `<div class="bloc">
        <h2>${icone('grass')}Cultures ${esc(a.cultures_annee || '')} <span class="doux h2-doux">· ${nf(totalHa, 0)} ha</span></h2>
        <div class="barre-cultures" aria-hidden="true">${cultures.map((c) => `<i style="flex:${Number(c.ha) || 0};background:${couleurCulture(c.code)}"></i>`).join('')}</div>
        ${cultures.map((c) => `<button class="ligne-culture" data-carte-code="${esc(c.code)}">${pastilleCulture(c.code)}<span class="nom">${esc(c.culture)}</span><b>${nf(c.ha, 1)} ha</b></button>`).join('')}
        <p class="note" style="margin-bottom:0">Déclaration PAC ${esc(a.cultures_annee || '')} (Télépac). Touche une culture pour la voir en jaune sur la carte.</p>
      </div>` : ''}

      <p class="note pied">${Object.keys(nomsAteliers).filter((k) => maj[k]).length ? `À jour : ${Object.keys(nomsAteliers).filter((k) => maj[k]).map((k) => `${esc(nomsAteliers[k])} ${esc(dateFr(maj[k], true))}`).join(' · ')}<br>` : ''}Ferme Denis · version ${esc(C.version)}</p>`;
    brancher(el);
    $('#accueil-chercher', el).addEventListener('click', ouvrirRecherche);
    blocAFaireAccueil($('#zone-a-faire', el));
    blocMeteo($('#zone-meteo', el));
    $$('[data-lot-accueil]', el).forEach((b) => b.addEventListener('click', () => ouvrir('Lot', (x) => vueLot(x, b.dataset.lotAccueil))));
    // Alertes du suivi jour par jour (registre MyTR) des lots en cours
    let releveSignale = false;
    lotsEnCours(tousLots).forEach((l) => lire('lot', { lot_id: l.lot_id }).then((detail) => {
      const s = suiviLot(l, detail);
      const fil = $('.fil-alertes', el);
      // Le relevé MyTR du matin (tâche de 9 h sur le Mac) n'a pas tourné depuis plus d'un jour : on le dit
      const releve = detail && detail.releves_le ? new Date(detail.releves_le) : null;
      if (fil && releve && !isNaN(releve) && Date.now() - releve.getTime() > 26 * 3600000 && !releveSignale) {
        releveSignale = true;
        const r = document.createElement('div');
        r.className = 'alerte-ligne attention';
        r.innerHTML = `${icone('sync_problem')}<span class="txt"><b>Suivi des poulets pas à jour</b><span>Dernier relevé MyTR le ${esc(dateFr(String(detail.releves_le).slice(0, 10)))} : le relevé de 9 h n'a pas tourné (Mac éteint ?).</span></span>`;
        fil.appendChild(r);
      }
      if (!s || !s.d || !s.alertes.length || !fil) return;
      const b = document.createElement('button');
      b.className = 'alerte-ligne attention';
      b.innerHTML = `${icone('warning')}<span class="txt"><b>${esc(batNom(l.batiment))} · jour ${nf(s.d.j)}</b><span>${esc(s.alertes.join(' ; '))}</span></span>`;
      b.addEventListener('click', () => ouvrir('Lot', (x) => vueLot(x, l.lot_id)));
      fil.prepend(b);
    }).catch(() => {}));
    $$('[data-carte-code]', el).forEach((bt) => bt.addEventListener('click', () => allerOnglet('carte', { code: bt.dataset.carteCode })));
    // Troupeau : bêtes à regarder côté vêlages (calcul de l'appli sur les données EDE)
    lire('troupeau').then((tr) => {
      const n = tr && tr.velages ? betesARegarder(tr.velages).length : 0;
      const fil = $('.fil-alertes', el);
      if (!n || !fil) return;
      const rien = $('.alerte-ligne.rien', fil);
      if (rien) rien.remove();
      const bt = document.createElement('button');
      bt.className = 'alerte-ligne info';
      bt.innerHTML = `${icone('child_friendly')}<span class="txt"><b>Troupeau : ${pluriel(n, 'bête')} à regarder</b><span>Long écart entre 2 vêlages, ou génisse âgée sans veau connu.</span></span>`;
      bt.addEventListener('click', () => allerOnglet('vaches', { velages: true }));
      fil.appendChild(bt);
    }).catch(() => {});

    const fermerBienvenue =() => { try { localStorage.setItem(CLE_BIENVENUE, '1'); } catch (e) { /* stockage indisponible */ } };
    const bFermer = $('.fermer-bienvenue', el);
    if (bFermer) bFermer.addEventListener('click', () => { fermerBienvenue(); bFermer.closest('.bienvenue').remove(); });
    $$('[data-essai]', el).forEach((b) => b.addEventListener('click', () => {
      fermerBienvenue();
      if (b.dataset.essai === 'chercher') ouvrirRecherche();
      else if (b.dataset.essai === 'lot' && dernierLotFini) { ouvrir('Lot', (x) => vueLot(x, dernierLotFini.lot_id)); }
      else allerOnglet('discuter');
    }));

    // Administrateur : quelqu'un attend sa validation ?
    if (a.role === 'admin') {
      try {
        const attente = (await gerer('membres')).filter((m) => m.etat === 'en_attente');
        const zone = $('#zone-attente', el);
        if (zone && attente.length) {
          zone.innerHTML = `<div class="bloc alerte-validation">${attente.map((m) => `<div class="membre">
            <span class="avatar gris">${esc(String(m.nom).charAt(0))}</span>
            <span class="txt"><b>${esc(m.nom)} veut entrer dans l'appli</b><span class="doux">Son compte est créé, il attend ta validation.</span></span>
            <button class="bouton-principal petit-bouton" data-valider="${esc(m.membre_id)}" data-nom="${esc(m.nom)}">Valider</button></div>`).join('')}</div>`;
          $$('[data-valider]', zone).forEach((b) => b.addEventListener('click', async () => {
            if (!confirm(`Laisser entrer ${b.dataset.nom} dans l'appli ?`)) return;
            b.disabled = true;
            try { await gerer('valider', { membre_id: b.dataset.valider }); b.closest('.membre').innerHTML = `<span class="txt"><b>${icone('check_circle', 'plein petite')} ${esc(b.dataset.nom)} peut entrer.</b><span class="doux">Dis-lui d'appuyer sur « Vérifier ».</span></span>`; }
            catch (e) { alert(messageErreur(e)); b.disabled = false; }
          }));
        }
      } catch (e) { /* bloc facultatif */ }
    }
  }
  const CLE_BIENVENUE = 'ferme-denis-bienvenue-v1';
  // Mots courts pour les 4 chiffres du troupeau sur l'accueil
  const LIBELLES_COURTS = { vaches: 'Vaches', genisses: 'Génisses', veaux: 'Veaux', males: 'Mâles' };
  // Date de l'inventaire EDE si la base ne la donne pas (accueil.bovins.inventaire_le)
  const INVENTAIRE_EDE = '2026-10-31';

  // =====================================================================
  // Troupeau
  // =====================================================================
  const FILTRES_VACHES = [
    { id: 'toutes', libelle: 'Toutes', test: () => true },
    { id: 'vaches', libelle: 'Vaches', test: (v) => v.categorie_ede === 'VA' },
    { id: 'genisses', libelle: 'Génisses (1 an et +)', test: (v) => v.categorie_ede === 'GV' && v.age_mois >= 12 },
    { id: 'veaux', libelle: "Veaux (moins d'1 an)", test: (v) => v.age_mois < 12 },
    { id: 'males', libelle: 'Mâles (1 an et +)', test: (v) => v.categorie_ede === 'MA' && v.age_mois >= 12 }
  ];
  let filtreVaches = 'toutes';
  let triVaches = 'numero';

  async function vueVaches(el, options) {
    const [toutes, tr] = await Promise.all([lire('vaches'), lire('troupeau')]);
    if (options && options.filtre && FILTRES_VACHES.some((f) => f.id === options.filtre)) filtreVaches = options.filtre;
    const compte = (id) => toutes.filter(FILTRES_VACHES.find((f) => f.id === id).test).length;
    const races = tr.races || {};
    el.innerHTML = `
      <form class="recherche" id="form-vache">
        ${icone('search')}
        <input id="numero-vache" type="search" inputmode="numeric" autocomplete="off" placeholder="Numéro, ex. 1142" aria-label="Numéro de la bête">
        <button type="submit">Voir</button>
      </form>
      <div class="groupes">${FILTRES_VACHES.filter((f) => f.id !== 'toutes').map((f) => `
        <button class="groupe${f.id === filtreVaches ? ' actif' : ''}" data-filtre="${f.id}"><b>${nf(compte(f.id))}</b><span>${esc(f.libelle)}</span></button>`).join('')}</div>

      <div class="bloc">
        <h2>${icone('location_on')}Où sont les bêtes</h2>
        ${(tr.groupes || []).map((g) => `<div class="ligne" style="display:block">
          <b>${esc(g.nom)}</b><br><span class="doux">${esc(g.emplacement || '')}${g.rations && g.rations.length ? ' · ' + esc(g.rations.join(', ')) : ''}</span></div>`).join('')}
        <p class="note">Groupes et rations décrits par Hugo début novembre. Seules quelques bêtes sont déjà rattachées à un groupe.</p>
      </div>

      ${(tr.naissances || []).length ? `<div class="bloc">
        <h2>${icone('bar_chart')}Naissances des 24 derniers mois</h2>
        <div id="graph-naissances"></div>
        <p class="doux" id="detail-naissances" style="min-height:1.4em;margin:6px 0 0">Touche une barre pour voir le mois.</p>
        <p class="note">Veaux nés sur la ferme, y compris ceux déjà partis (historique EDE des mouvements). Les bêtes achetées ne comptent pas.</p>
      </div>` : ''}

      ${tr.velages ? blocVelages(tr.velages) : ''}

      <div class="bloc" id="bloc-sorties"><h2>${icone('logout')}Bêtes parties</h2><p class="doux" style="margin:0">Chargement de l'historique EDE…</p></div>

      <div class="bloc">
        <h2>${icone('category')}Races</h2>
        <div class="puces" style="flex-wrap:wrap">${Object.entries(races).sort((x, y) => y[1] - x[1]).map(([r, n]) => `<span class="puce">${esc(r)} · ${nf(n)}</span>`).join('')}</div>
        ${(tr.taureaux || []).length ? `<h3>Taureaux</h3>${tr.taureaux.map((t) => ligne(`<b>${esc(t.numero)}</b> · ${esc(t.race || '')}<br><span class="doux">${esc(age(t.age_mois))}${t.groupe ? ' · ' + esc(t.groupe) : ''}</span>`, `<button class="bouton-secondaire" data-num="${esc(t.numero)}">Fiche</button>`)).join('')}` : ''}
        <p class="note">Races d'après l'EDE ; « Croisée » reste à préciser.</p>
      </div>

      <div class="entete-liste">
        <div class="puces" style="margin:0"><button class="puce${filtreVaches === 'toutes' ? ' actif' : ''}" data-filtre="toutes">Toutes (${nf(toutes.length)})</button></div>
        <select id="tri-vaches" aria-label="Trier"><option value="numero">Par numéro</option><option value="age">Les plus jeunes</option><option value="vieilles">Les plus âgées</option></select>
      </div>
      <p class="doux" id="compte-vaches"></p>
      <div class="bloc"><ul class="liste" id="liste-vaches"></ul></div>
      <p class="note">Inventaire EDE du 31/10/2026.</p>`;

    if ((tr.naissances || []).length) {
      const serie = tr.naissances.map((n) => ({ cle: n.mois, valeur: Number(n.femelles) + Number(n.males), f: n.femelles, m: n.males, partis: Number(n.partis) || 0 }));
      $('#graph-naissances', el).innerHTML = graphSimple(serie, { etiquette: (p) => p.cle.slice(5, 7) === '01' || serie.indexOf(p) === 0 ? moisCourt(p.cle, true) : moisCourt(p.cle), dec: 0 });
      $$('#graph-naissances [data-i]', el).forEach((z) => z.addEventListener('click', () => {
        const p = serie[Number(z.dataset.i)];
        $('#detail-naissances', el).textContent = `${moisLong(p.cle)} : ${pluriel(p.valeur, 'veau')} (${p.f} femelle${p.f > 1 ? 's' : ''}, ${p.m} mâle${p.m > 1 ? 's' : ''})${p.partis ? ` · ${p.partis} déjà parti${p.partis > 1 ? 's' : ''}` : ''}`;
      }));
    }
    if (options && options.velages) setTimeout(() => { const b = $('#bloc-velages', el); if (b) b.scrollIntoView({ block: 'start' }); }, 50);
    // Bêtes parties : chargé à part (l'historique EDE est plus lourd), la page s'affiche sans attendre
    lire('sorties').then((s) => {
      dessinerSorties($('#bloc-sorties', el), s);
      if (options && options.sorties) { const b = $('#bloc-sorties', el); if (b) b.scrollIntoView({ block: 'start' }); }
    }).catch(() => { const b = $('#bloc-sorties', el); if (b) b.remove(); });

    const champ = $('#numero-vache', el);
    $('#tri-vaches', el).value = triVaches;
    const dessiner = () => {
      const q = champ.value.trim().replace(/\s/g, '');
      const f = FILTRES_VACHES.find((x) => x.id === filtreVaches);
      const liste = toutes.filter((v) => f.test(v) &&
        (!q || String(v.numero_travail || '').includes(q) || String(v.numero_national || '').replace(/\s/g, '').endsWith(q)));
      if (triVaches === 'age') liste.sort((x, y) => (x.age_mois ?? 999) - (y.age_mois ?? 999));
      else if (triVaches === 'vieilles') liste.sort((x, y) => (y.age_mois ?? -1) - (x.age_mois ?? -1));
      else liste.sort((x, y) => String(x.numero_travail).localeCompare(String(y.numero_travail)));
      $('#compte-vaches', el).textContent = pluriel(liste.length, 'bête');
      $('#liste-vaches', el).innerHTML = liste.map((v) => `
        <li><button data-num="${esc(v.numero_national)}">
          <span class="g"><b>${esc(v.numero_travail)} <span class="etiquette">${esc(v.categorie_ede === 'VA' ? 'vache' : v.categorie_ede === 'MA' ? 'mâle' : (v.age_mois < 12 ? 'veau' : 'génisse'))}</span></b>
          <span class="doux">${esc(age(v.age_mois))}${v.race ? ' · ' + esc(v.race) : ''}${v.nb_veaux_presents ? ' · ' + pluriel(v.nb_veaux_presents, 'veau') : ''}</span></span>
          <span class="d">${esc(v.groupe_actuel ? v.groupe_actuel.split(':')[0] : '')}</span>
        </button></li>`).join('') || '<li class="doux" style="padding:12px 0">Aucune bête ne correspond.</li>';
      $$('#liste-vaches button', el).forEach((bt) => bt.addEventListener('click', () => ouvrirVache(bt.dataset.num)));
    };
    champ.addEventListener('input', dessiner);
    $('#tri-vaches', el).addEventListener('change', (ev) => { triVaches = ev.target.value; dessiner(); });
    $('#form-vache', el).addEventListener('submit', (ev) => { ev.preventDefault(); const q = champ.value.trim(); if (q) ouvrirVache(q); });
    if (options && options.focus) champ.focus();
    if (options && options.filtre) setTimeout(() => { const c = $('#compte-vaches', el); if (c) c.scrollIntoView({ block: 'start' }); }, 50);
    $$('[data-filtre]', el).forEach((bt) => bt.addEventListener('click', () => {
      filtreVaches = bt.dataset.filtre;
      $$('[data-filtre]', el).forEach((x) => x.classList.toggle('actif', x.dataset.filtre === filtreVaches));
      dessiner();
      $('#compte-vaches', el).scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
    $$('.bloc [data-num]', el).forEach((bt) => bt.addEventListener('click', () => ouvrirVache(bt.dataset.num)));
    dessiner();
  }

  const moisCourt = (cle, avecAn) => {
    const d = new Date(cle + '-15T12:00:00');
    const m = d.toLocaleDateString('fr-FR', { month: 'short' }).replace('.', '');
    return avecAn ? m + ' ' + String(d.getFullYear()).slice(2) : m;
  };
  const moisLong = (cle) => new Date(cle + '-15T12:00:00').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

  function ouvrirVache(numero) { ouvrir('Bête', (el) => vueVache(el, numero)); }

  // Historique EDE des mouvements (export du 18/11/2026, depuis 2017).
  // Les codes de sortie EDE sont gardés tels quels (E, B, M…) ; les mots simples sont juste à côté.
  const estVache = (a) => a === 'VA' || a === 'VL';
  const accord = (sx, m, f) => (sx === 'F' ? f : m);
  const moisEntre = (d1, d2) => {
    if (!d1 || !d2) return null;
    const a = new Date(String(d1).slice(0, 10) + 'T12:00:00'), b = new Date(String(d2).slice(0, 10) + 'T12:00:00');
    let m = (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth();
    if (b.getDate() < a.getDate()) m--;
    return Math.max(0, m);
  };
  // Ce qu'était la bête quand elle est partie (un veau de 3 mois n'est pas « un mâle »)
  const quoiBete = (a, sx, mois) => (estVache(a) ? 'vache' : a === 'MA' ? (mois != null && mois < 12 ? 'veau mâle' : 'mâle') : (mois != null && mois < 12 ? 'velle' : 'génisse'));
  const motSortie = (c) => ({ E: "vente pour l'élevage", B: 'boucherie', M: 'mort' }[c] || 'code ' + (c || '?'));
  // « MOL » et « MOL GUERLESQUIN » (destinations écrites par l'EDE) = le marché où la ferme vend ses bêtes (dit par Hugo le 18/11/2026)
  const estMarche = (d) => /^MOL( GUERLESQUIN)?$/.test(String(d || '').trim().toUpperCase());
  function phraseSortie(cause, destination, sx, date) {
    const quand = date ? ' le ' + dateFr(date) : '';
    const equarrissage = /EQUARRISSAGE/i.test(destination || '');
    const vers = destination && !equarrissage ? (estMarche(destination) ? ', au marché (MOL)' : ', vers ' + destination) : '';
    if (cause === 'E') return accord(sx, 'vendu', 'vendue') + " pour l'élevage" + quand + vers;
    if (cause === 'B') return accord(sx, 'parti', 'partie') + ' en boucherie' + quand + vers;
    if (cause === 'M') return accord(sx, 'mort', 'morte') + quand + (equarrissage ? ' (équarrissage)' : '');
    return accord(sx, 'sorti', 'sortie') + quand + ' (code EDE ' + (cause || '?') + ')' + vers;
  }
  const ligneVeauParti = (v) => `
    <li><button data-num="${esc(v.numero_national)}"><span class="g"><b>${esc(v.numero_travail)}</b>
    <span class="doux">${esc(sexe(v.sexe))} · ${accord(v.sexe, 'né', 'née')} le ${esc(dateFr(v.date_naissance))}<br>${esc(majuscule(phraseSortie(v.cause_sortie, v.destination, v.sexe, v.date_sortie)))}</span></span></button></li>`;
  const ligneVeauPresent = (v) => `
    <li><button data-num="${esc(v.numero_national || v.numero_travail)}"><span class="g"><b>${esc(v.numero_travail)}</b>
    <span class="doux">${esc(sexe(v.sexe))} · ${v.sexe === 'F' ? 'née' : 'né'} le ${esc(dateFr(v.date_naissance))}</span></span></button></li>`;
  // Vêlages du troupeau (calcul de l'appli sur les données EDE) : intervalle, âge au 1er vêlage, veaux morts, bêtes à regarder
  function betesARegarder(v) {
    return [
      ...(v.ivv_longs || []).map((x) => ({ n: x.national, t: x.numero, txt: `${nf(x.jours)} jours entre ses 2 derniers vêlages (dernier le ${dateFr(x.dernier)})` })),
      ...(v.sans_velage_12_mois || []).map((x) => ({ n: x.national, t: x.numero, txt: x.dernier ? `dernier vêlage connu il y a ${nf(x.jours)} jours (le ${dateFr(x.dernier)})` : 'aucun veau connu (inventaire et historique EDE depuis 2017)' })),
      ...(v.genisses_36_mois || []).map((x) => ({ n: x.national, t: x.numero, txt: `génisse de ${nf(x.age_mois)} mois, aucun veau connu : à vérifier (historique incomplet)` }))];
  }
  function blocVelages(v) {
    const mort = v.mortalite || [];
    const anCourant = new Date().getFullYear();
    const derniereEntiere = mort.find((m) => m.annee < anCourant);
    const pct = (m) => (m && m.nes ? (100 * m.morts_6_mois) / m.nes : null);
    const aRegarder = betesARegarder(v);
    return `<div class="bloc" id="bloc-velages">
      <h2>${icone('child_friendly')}Vêlages</h2>
      <div class="chiffres trois">
        <div class="chiffre"><b>${nf(v.ivv_moyen)} j</b><span>entre 2 vêlages, en moyenne</span></div>
        <div class="chiffre"><b>${nf(v.age_premier_velage_mois, 0)} mois</b><span>âge au 1er vêlage</span></div>
        <div class="chiffre"><b>${derniereEntiere ? nf(pct(derniereEntiere), 0) + ' %' : '—'}</b><span>veaux morts avant 6 mois${derniereEntiere ? ' en ' + derniereEntiere.annee : ''}</span></div>
      </div>
      <p class="doux" style="margin:8px 0 0">Intervalle calculé sur ${pluriel(v.ivv_nb, 'vache')} qui ont eu 2 veaux ou plus ces 2 dernières années ; la moitié est sous ${nf(v.ivv_median)} jours. Repère courant : un veau par vache et par an, soit environ 365 jours.</p>
      ${aRegarder.length ? `<h3>À regarder (${nf(aRegarder.length)})</h3><ul class="liste">${aRegarder.map((x) => `
        <li><button data-num="${esc(x.n)}"><span class="g"><b>${esc(x.t)}</b><span class="doux">${esc(x.txt)}</span></span></button></li>`).join('')}</ul>
        <p class="doux" style="margin:4px 0 0">Plus de 15 mois entre 2 vêlages : vêlage manqué, ou veau mort-né sans numéro. À vérifier avec le carnet.</p>` : ''}
      ${mort.length ? `<details class="replier"><summary>Veaux morts, année par année</summary>
        <table><thead><tr><th>Année</th><th>Nés</th><th>Morts 48 h</th><th>Morts &lt; 6 mois</th><th>%</th></tr></thead><tbody>
        ${mort.map((m) => `<tr><td>${esc(m.annee)}${m.annee >= anCourant ? '<br><span class="doux">en cours</span>' : ''}</td><td>${nf(m.nes)}</td><td>${nf(m.morts_48h)}</td><td>${nf(m.morts_6_mois)}</td><td>${nf(pct(m), 0)} %</td></tr>`).join('')}
        </tbody></table></details>` : ''}
      <p class="note">${esc(v.source)}</p>
    </div>`;
  }
  // Résumé des vêlages d'une vache, à partir de ses veaux encore là et de ceux déjà partis
  function ligneVelages(veaux, veauxPartis) {
    const dates = Array.from(new Set((veaux || []).concat(veauxPartis || []).map((v) => String(v.date_naissance || '').slice(0, 10)).filter(Boolean))).sort();
    if (!dates.length) return '';
    const ecarts = dates.slice(1).map((d, i) => Math.round((new Date(d + 'T12:00:00') - new Date(dates[i] + 'T12:00:00')) / 86400000));
    const dernier = dates[dates.length - 1];
    const moy = ecarts.length ? ecarts.reduce((s, x) => s + x, 0) / ecarts.length : null;
    return ligne('Vêlages connus', `${nf(dates.length)} · dernier le ${esc(dateFr(dernier))}<br><span class="doux">il y a ${nf(joursDepuis(dernier))} jours${ecarts.length ? ` · ${nf(ecarts[ecarts.length - 1])} j depuis le précédent · moyenne ${nf(moy)} j` : ''}</span>`);
  }
  // La mère : encore là, partie (avec sa sortie), ou inconnue de l'historique
  function ligneMere(numeroMere, merePresente, merePartie) {
    if (!numeroMere) return ligne('Mère', '—');
    if (merePresente) return ligne('Mère', `<button class="bouton-secondaire" id="voir-mere">${esc(String(numeroMere).replace(/\s/g, '').slice(-4))} ›</button><br><span class="doux">encore au troupeau</span>`);
    if (merePartie) return ligne('Mère', `<button class="bouton-secondaire" id="voir-mere">${esc(merePartie.numero_travail)} ›</button><br><span class="doux">${esc(majuscule(phraseSortie(merePartie.cause_sortie, merePartie.destination, 'F', merePartie.date_sortie)))}</span>`);
    return ligne('Mère', `${esc(numeroMere)}<br><span class="doux">plus dans le troupeau, pas dans l'historique EDE depuis 2017</span>`);
  }

  const TYPES_FAITS = {
    velage: 'Vêlage', mise_au_taureau: 'Mise au taureau', saillie_ia: 'Insémination', diagnostic_gestation: 'Contrôle de gestation',
    avortement: 'Avortement', soin: 'Soin', traitement: 'Traitement', mort: 'Mort', autre: 'Autre', naissance: 'Naissance', achat: 'Achat',
    sortie: 'Sortie', vente: 'Vente', changement_de_groupe: 'Changement de groupe', comptage: 'Comptage', mesure: 'Mesure', travaux: 'Travaux', remarque: 'Remarque',
    loyer: 'Loyer', locataire: 'Locataire', depense: 'Dépense'
  };
  const nomFait = (q) => TYPES_FAITS[q] || (q ? q.charAt(0).toUpperCase() + q.slice(1) : '');
  const ICONES_FAITS = { naissance: 'cake', achat: 'shopping_cart', velage: 'child_friendly', soin: 'healing', traitement: 'vaccines', mort: 'heart_broken', sortie: 'logout', vente: 'sell',
    travaux: 'construction', loyer: 'payments', locataire: 'person', depense: 'euro', remarque: 'sticky_note_2' };
  const iconeFait = (q) => ICONES_FAITS[q] || (String(q).startsWith('vêlage') ? 'child_friendly' : String(q).startsWith('mis dans') ? 'swap_horiz' : 'event_note');

  function texteDetail(d) {
    if (!d) return '';
    try {
      const o = JSON.parse(d);
      if (o && typeof o === 'object') {
        const morceaux = [];
        const parcourir = (obj, prefixe) => Object.entries(obj).forEach(([k, v]) => {
          if (v === null || v === undefined || v === '') return;
          if (typeof v === 'object') parcourir(v, k);
          else morceaux.push((prefixe ? prefixe + ' ' : '') + k.replace(/_/g, ' ') + ' : ' + v);
        });
        parcourir(o, '');
        return morceaux.join(' · ');
      }
    } catch (e) { /* texte simple */ }
    return nettoyerDetail(d);
  }
  // D'où vient une ligne d'antécédents, en mots simples
  const sourceHisto = (s) => { const t = String(s || ''); return /^(inventaire|historique) EDE/i.test(t) ? 'EDE' : /carnet/i.test(t) ? 'carnet' : /comptage-20261107/.test(t) ? 'comptage du 7 nov.' : /appli|famille/i.test(t) ? 'famille' : t; };
  // « veau 1435, F, - » → « veau 1435, femelle »
  const nettoyerDetail = (t) => String(t || '').replace(/(,\s*-\s*)+$/g, '').replace(/,\s*F\b/g, ', femelle').replace(/,\s*M\b/g, ', mâle').trim();
  // Deux vêlages le même jour = des jumeaux
  function regrouperJumeaux(h) {
    const res = [];
    (h || []).forEach((x) => {
      const prec = res[res.length - 1];
      if (prec && x.date && prec.date === x.date && /^vêlage/.test(String(x.quoi)) && /^vêlage/.test(String(prec.quoi))) {
        prec.quoi = 'vêlage de jumeaux';
        prec.detail = nettoyerDetail(texteDetail(prec.detail)) + ' et ' + nettoyerDetail(texteDetail(x.detail));
      } else res.push(Object.assign({}, x));
    });
    return res;
  }

  async function vueVache(el, numero) {
    const r = await lire('vache', { numero });
    if (!r || r.length === 0) {
      el.innerHTML = `<div class="bloc"><h2>${icone('search_off')}Pas trouvé</h2><p>Aucune bête avec le numéro « ${esc(numero)} », ni dans l'inventaire, ni parmi les bêtes parties depuis 2017.</p></div>`;
      return;
    }
    if (r.length > 1) {
      el.innerHTML = `<div class="bloc"><h2>Plusieurs bêtes</h2><ul class="liste">${r.map((x) => `
        <li><button data-num="${esc(x.fiche.numero_national)}"><span class="g"><b>${esc(x.fiche.numero_travail)}</b>
        <span class="doux">${esc(x.fiche.numero_national)} · ${x.parti
          ? esc(quoiBete(x.fiche.categorie_ede, x.fiche.sexe, moisEntre(x.fiche.date_naissance, x.fiche.date_sortie))) + ' · ' + esc(phraseSortie(x.fiche.cause_sortie, null, x.fiche.sexe, x.fiche.date_sortie))
          : esc(x.fiche.categorie) + ' · encore au troupeau'}</span></span></button></li>`).join('')}</ul></div>`;
      $$('button[data-num]', el).forEach((bt) => bt.addEventListener('click', () => ouvrirVache(bt.dataset.num)));
      return;
    }
    if (r[0].parti) { vueBetePartie(el, r[0]); return; }
    const { fiche: f, veaux, mere_presente: merePresente } = r[0];
    const veauxPartis = r[0].veaux_partis || [];
    const merePartie = r[0].mere_partie;
    // Vêlages des veaux déjà partis (historique EDE), sauf si ce veau est déjà cité dans les antécédents
    const histoBrut = r[0].historique || [];
    const dejaCite = (num) => histoBrut.some((x) => new RegExp('(^|\\D)' + num + '(\\D|$)').test(String(x.detail || '')));
    const histo = histoBrut.concat(veauxPartis.filter((v) => v.date_naissance && !dejaCite(v.numero_travail)).map((v) => ({
      date: v.date_naissance, precision_date: 'jour', quoi: 'vêlage', source: 'historique EDE',
      detail: `veau ${v.numero_travail}, ${v.sexe === 'F' ? 'femelle' : 'mâle'}, ${phraseSortie(v.cause_sortie, v.destination, v.sexe, v.date_sortie)}`
    }))).sort((a, b) => String(b.date || '9999').localeCompare(String(a.date || '9999')));
    const h = regrouperJumeaux(histo);
    const nbVeaux = veaux.length + veauxPartis.length;
    titrePage(el, 'N° ' + f.numero_travail);
    // Un vêlage noté dans le carnet compte, même si l'inventaire EDE la classe encore génisse
    const veleSelonCarnet = f.sexe === 'F' && f.categorie_ede !== 'VA' && h.some((x) => /^v[êe]lage/i.test(String(x.quoi)) && !/inventaire/i.test(String(x.source || '')));
    const etiquette = f.categorie_ede === 'VA' || veleSelonCarnet ? 'Vache' : f.categorie_ede === 'MA' ? 'Mâle' : (f.age_mois < 12 ? 'Veau' : 'Génisse');

    el.innerHTML = `
      <div class="bloc fiche-tete">
        <div class="numero-grand">${esc(f.numero_travail)}</div>
        <div class="badges"><span class="badge">${esc(etiquette)}</span>${f.race ? `<span class="badge">${esc(f.race)}</span>` : ''}<span class="badge">${esc(sexe(f.sexe))}</span></div>
        ${veleSelonCarnet ? '<p class="note" style="margin:8px 0 0">Un vêlage est noté dans le carnet, mais l\'inventaire EDE du 31/10 la classe encore « génisse ».</p>' : ''}
        <div class="chiffres" style="margin-top:12px">
          <div class="chiffre"><b>${esc(age(f.age_mois))}</b><span>âge</span></div>
          ${chiffre(veaux.length, veaux.length > 1 ? 'veaux encore là' : 'veau encore là')}
          ${veauxPartis.length ? chiffre(nbVeaux, nbVeaux > 1 ? 'veaux connus' : 'veau connu') : ''}
        </div>
      </div>
      <div class="actions-bete" role="group" aria-label="Noter vite pour cette bête">
        ${f.sexe === 'F' ? `<button data-action-bete="velage">${icone('child_friendly')}<span>Vêlage</span></button>` : ''}
        <button data-action-bete="soin">${icone('healing')}<span>Soin</span></button>
        <button data-action-bete="remarque">${icone('sticky_note_2')}<span>Remarque</span></button>
        <button data-action-bete="a_faire">${icone('add_task')}<span>À faire</span></button>
      </div>

      <div class="bloc">
        <h2>${icone('badge')}Identité</h2>
        ${ligne('Numéro national', esc(f.numero_national))}
        ${ligne('Née le', esc(dateFr(f.date_naissance)))}
        ${ligne('Origine', esc(/^aucune entrée/.test(f.origine || '') ? 'Née sur la ferme (d\'après l\'EDE)' : (f.origine || '—')))}
        ${ligne('Groupe actuel', esc(f.groupe_actuel ? f.groupe_actuel : 'pas encore noté'))}
      </div>

      <div class="bloc">
        <h2>${icone('family_restroom')}Famille</h2>
        ${ligneMere(f.mere_numero, merePresente, merePartie)}
        ${ligne('Père', esc(f.pere_numero || 'non indiqué'))}
        ${ligneVelages(veaux, veauxPartis)}
        ${veaux.length ? `<h3>Veaux encore au troupeau</h3><ul class="liste">${veaux.map(ligneVeauPresent).join('')}</ul>` : ''}
        ${veauxPartis.length ? `<h3>Veaux déjà partis</h3><ul class="liste">${veauxPartis.map(ligneVeauParti).join('')}</ul>` : ''}
      </div>

      <div class="bloc">
        <h2>${icone('history')}Antécédents</h2>
        ${h.length ? `<ul class="fil">${h.map((x) => `
          <li><div class="date">${x.date ? esc(dateFr(x.date)) : 'date inconnue'}${x.precision_date && x.precision_date !== 'jour' && x.date ? ' (' + esc(x.precision_date) + ')' : ''}</div>
          <div>${icone(iconeFait(x.quoi), 'petite')} <b>${esc(nomFait(String(x.quoi || '').replace(/\s*\(veau encore présent\)/, '')))}</b> <span class="etiquette">${esc(sourceHisto(x.source))}</span></div>
          ${x.detail ? `<div class="doux">${esc(texteDetail(x.detail))}</div>` : ''}</li>`).join('')}</ul>` : '<p class="doux">Rien de noté pour l\'instant.</p>'}
        <p class="note">Les veaux déjà partis viennent de l'historique EDE des mouvements (depuis 2017) ; ceux partis avant 2017 n'y sont pas. Les soins et saillies apparaîtront dès qu'ils seront notés.</p>
      </div>
      <div id="infos-vache"></div>
      <div id="docs-vache"></div>
      <button class="bouton-principal" id="ajouter-info-vache" style="width:100%">${icone('add_circle')}Noter une info sur la ${esc(f.numero_travail)}</button>`;

    blocDocuments($('#docs-vache', el), { type: 'vache', id: f.numero_national, libelle: 'N° ' + f.numero_travail, vide: 'Ordonnance, analyse, photo de la bête : ajoute-les ici.' });
    // Infos notées par la famille sur cette bête (pas encore dans le registre de l'atelier)
    lire('ajouts', { numero_animal: String(f.numero_travail) }).then((a) => {
      const zone = $('#infos-vache', el);
      const liste = (a || []).filter((x) => x.statut !== 'annule');
      if (!zone || !liste.length) return;
      zone.innerHTML = `<div class="bloc"><h2>${icone('edit_note')}Noté par la famille</h2><ul class="fil">${liste.map((x) => `
        <li><div class="date">${esc(x.date_evenement ? dateFr(x.date_evenement) : 'date inconnue')} · ${esc(x.auteur)}</div>
        <div>${icone(iconeFait(x.type), 'petite')} <b>${esc(nomFait(x.type))}</b>${x.statut === 'a_integrer' ? ' <span class="etiquette">à intégrer</span>' : ''}</div>
        <div class="doux">${esc(x.resume)}</div></li>`).join('')}</ul></div>`;
    }).catch(() => {});
    $('#ajouter-info-vache', el).addEventListener('click', () => noter({ atelier: 'bovins', numero_animal: f.numero_travail, libelle: 'N° ' + f.numero_travail }));
    // Actions rapides : le formulaire s'ouvre déjà sur la bonne bête et le bon type
    $$('[data-action-bete]', el).forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.actionBete === 'a_faire') ajouterAFaire(null, { atelier: 'bovins', texte: 'N° ' + f.numero_travail + ' : ' });
      else noter({ atelier: 'bovins', numero_animal: f.numero_travail, libelle: 'N° ' + f.numero_travail, type: b.dataset.actionBete });
    }));
    if (merePresente || merePartie) $('#voir-mere', el).addEventListener('click', () => ouvrirVache(merePresente ? f.mere_numero : merePartie.numero_national));
    $$('button[data-num]', el).forEach((bt) => bt.addEventListener('click', () => ouvrirVache(bt.dataset.num)));
  }

  // Fiche d'une bête déjà partie : tout vient de l'historique EDE des mouvements
  function vueBetePartie(el, x) {
    const f = x.fiche, veaux = x.veaux || [], veauxPartis = x.veaux_partis || [];
    const moisSortie = moisEntre(f.date_naissance, f.date_sortie);
    const quoi = quoiBete(f.categorie_ede, f.sexe, moisSortie);
    const nbVeaux = veaux.length + veauxPartis.length;
    titrePage(el, 'N° ' + f.numero_travail);
    const arrivee = f.cause_entree === 'A'
      ? `${accord(f.sexe, 'Acheté', 'Achetée')} le ${dateFr(f.date_entree)}${f.provenance ? ', chez ' + f.provenance : ''}`
      : f.cause_entree === 'N' ? accord(f.sexe, 'Né', 'Née') + ' sur la ferme'
        : f.date_entree ? `Entrée le ${dateFr(f.date_entree)} (code EDE ${f.cause_entree || '?'})` : '—';
    el.innerHTML = `
      <div class="bloc fiche-tete">
        <div class="numero-grand">${esc(f.numero_travail)}</div>
        <div class="badges"><span class="badge">${esc(majuscule(quoi))}</span><span class="badge">${esc(sexe(f.sexe))}</span><span class="badge orange">${esc(accord(f.sexe, 'Parti', 'Partie'))}</span></div>
        <p style="margin:10px 0 0"><b>${esc(majuscule(phraseSortie(f.cause_sortie, f.destination, f.sexe, f.date_sortie)))}</b></p>
        <div class="chiffres" style="margin-top:12px">
          <div class="chiffre"><b>${esc(age(moisSortie))}</b><span>âge à la sortie</span></div>
          ${nbVeaux ? chiffre(nbVeaux, nbVeaux > 1 ? 'veaux connus' : 'veau connu') : ''}
        </div>
      </div>

      <div class="bloc">
        <h2>${icone('badge')}Identité</h2>
        ${ligne('Numéro national', esc(f.numero_national))}
        ${ligne(accord(f.sexe, 'Né le', 'Née le'), esc(dateFr(f.date_naissance)))}
        ${ligne('Arrivée', esc(arrivee))}
        ${ligne('Sortie', `${esc(dateFr(f.date_sortie))}<br><span class="doux">${esc(motSortie(f.cause_sortie))} · code EDE ${esc(f.cause_sortie || '?')}${f.destination ? ' · ' + esc(estMarche(f.destination) ? 'au marché (MOL)' : f.destination) : ''}</span>`)}
      </div>

      <div class="bloc">
        <h2>${icone('family_restroom')}Famille</h2>
        ${ligneMere(f.mere_numero, x.mere_presente, x.mere_partie)}
        ${ligne('Père', esc(f.pere_numero || 'non indiqué'))}
        ${ligneVelages(veaux, veauxPartis)}
        ${veaux.length ? `<h3>Veaux encore au troupeau</h3><ul class="liste">${veaux.map(ligneVeauPresent).join('')}</ul>` : ''}
        ${veauxPartis.length ? `<h3>Veaux déjà partis</h3><ul class="liste">${veauxPartis.map(ligneVeauParti).join('')}</ul>` : ''}
      </div>
      <p class="note">Bête partie : fiche tirée de l'historique EDE des mouvements (export du 18/11/2026, depuis le 1er janvier 2017). Ses soins et le carnet ne sont pas dans l'appli.</p>`;
    if (x.mere_presente || x.mere_partie) $('#voir-mere', el).addEventListener('click', () => ouvrirVache(x.mere_presente ? f.mere_numero : x.mere_partie.numero_national));
    $$('button[data-num]', el).forEach((bt) => bt.addEventListener('click', () => ouvrirVache(bt.dataset.num)));
  }

  // Bêtes parties (troupeau) : les 12 derniers mois, puis année par année ; toucher une année montre les bêtes
  function dessinerSorties(zone, s) {
    if (!zone || !s) return;
    const liste = s.liste || [];
    const d = new Date(); d.setFullYear(d.getFullYear() - 1);
    const limite = d.toISOString().slice(0, 10);
    const an12 = liste.filter((x) => String(x.ds) > limite);
    const vaches12 = an12.filter((x) => estVache(x.a));
    const nCause = (arr, c) => arr.filter((x) => x.c === c).length;
    const finAn = String(s.jusqu_au || '').slice(0, 4);
    const FILTRES = [['toutes', 'Toutes', () => true], ['vaches', 'Vaches', (x) => estVache(x.a)], ['E', 'Élevage', (x) => x.c === 'E'], ['B', 'Boucherie', (x) => x.c === 'B'], ['M', 'Morts', (x) => x.c === 'M']];
    let annee = null, filtre = 'toutes';
    zone.innerHTML = `<h2>${icone('logout')}Bêtes parties</h2>
      <h3 style="margin-top:0">Les 12 derniers mois</h3>
      <div class="chiffres">${chiffre(an12.length, 'bêtes parties')}${chiffre(vaches12.length, 'dont vaches')}</div>
      <p class="doux" style="margin:8px 0 0">Toutes les bêtes : ${pluriel(nCause(an12, 'E'), 'vendue')} pour l'élevage, ${nf(nCause(an12, 'B'))} en boucherie, ${pluriel(nCause(an12, 'M'), 'morte')}.<br>
        Les vaches : ${pluriel(nCause(vaches12, 'E'), 'vendue')} pour l'élevage, ${nf(nCause(vaches12, 'B'))} en boucherie, ${pluriel(nCause(vaches12, 'M'), 'morte')}.</p>
      <h3>Année par année</h3>
      <table class="tableau-sorties"><thead><tr><th>An</th><th>Total</th><th>Vaches</th><th>Élev.</th><th>Bouch.</th><th>Morts</th></tr></thead><tbody>
      ${(s.par_annee || []).map((a) => `<tr data-annee="${esc(a.annee)}"><td><b>${esc(a.annee)}</b>${String(a.annee) === finAn ? `<br><span class="doux">au ${esc(dateFr(s.jusqu_au, true))}</span>` : ''}</td>
        <td>${nf(a.total)}</td><td>${nf(a.vaches)}</td><td>${nf(a.elevage)}</td><td>${nf(a.boucherie)}</td><td>${nf(a.morts)}</td></tr>`).join('')}
      </tbody></table>
      <p class="doux" style="margin:8px 0 0">Touche une année pour voir les bêtes.</p>
      <div id="liste-sorties"></div>
      <p class="note">D'après l'historique EDE des mouvements (export du 18/11/2026, depuis le 1er janvier 2017). Codes EDE de sortie : E = vente pour l'élevage, B = boucherie, M = mort. « MOL » = le marché où on vend les bêtes.</p>`;
    const montrer = () => {
      $$('tr[data-annee]', zone).forEach((tr) => tr.classList.toggle('actif', tr.dataset.annee === String(annee)));
      if (!annee) return;
      const deLAnnee = liste.filter((x) => String(x.ds).slice(0, 4) === String(annee));
      const f = FILTRES.find((y) => y[0] === filtre) || FILTRES[0];
      const l = deLAnnee.filter(f[2]);
      $('#liste-sorties', zone).innerHTML = `<h3>${esc(annee)} · ${pluriel(deLAnnee.length, 'bête partie', 'bêtes parties')}</h3>
        <div class="puces" style="flex-wrap:wrap">${FILTRES.map(([id, lib, t]) => `<button class="puce${id === filtre ? ' actif' : ''}" data-filtre-sortie="${id}">${esc(lib)} (${nf(deLAnnee.filter(t).length)})</button>`).join('')}</div>
        <ul class="liste">${l.map((x) => `<li><button data-num="${esc(x.n)}"><span class="g"><b>${esc(x.t)} <span class="etiquette">${esc(quoiBete(x.a, x.s, moisEntre(x.dn, x.ds)))}</span></b>
          <span class="doux">${esc(majuscule(phraseSortie(x.c, x.v, x.s, x.ds)))}</span></span></button></li>`).join('') || '<li class="doux" style="padding:12px 0">Aucune bête.</li>'}</ul>`;
      $$('#liste-sorties [data-filtre-sortie]', zone).forEach((b) => b.addEventListener('click', () => { filtre = b.dataset.filtreSortie; montrer(); }));
      $$('#liste-sorties button[data-num]', zone).forEach((b) => b.addEventListener('click', () => ouvrirVache(b.dataset.num)));
    };
    $$('tr[data-annee]', zone).forEach((tr) => tr.addEventListener('click', () => {
      annee = annee === tr.dataset.annee ? null : tr.dataset.annee;
      filtre = 'toutes';
      if (!annee) $('#liste-sorties', zone).innerHTML = '';
      montrer();
      if (annee) $('#liste-sorties', zone).scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
  }

  // =====================================================================
  // Recherche unique : bêtes, ce qui pousse, champs, lots, bâtiments et maisons, papiers, infos notées
  // (tout se fait dans le téléphone, sur les données déjà chargées : pas d'IA, réponse immédiate)
  // =====================================================================
  const sansAccents = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  let derniereRecherche = '';
  function ouvrirRecherche() { ouvrir('Chercher', (el) => vueChercher(el)); }
  // Raccourcis vers les pages, trouvés par mots-clés
  const PAGES_RECHERCHE = [
    ['SCI et maisons', 'real_estate_agent', 'sci maison maisons location locataire loyer bail baux renovation logement', () => ouvrir(PAGES.sci[0], PAGES.sci[1])],
    ['Tous les papiers', 'folder_open', 'papier papiers document documents facture factures photo photos pdf contrat assurance', () => ouvrir(PAGES.documents[0], PAGES.documents[1])],
    ['Bâtiments', 'home_work', 'batiment batiments poulailler porcherie etable hangar maison', () => ouvrir(PAGES.batiments[0], PAGES.batiments[1])],
    ['Carte de la ferme', 'map', 'carte plan terres photo aerienne', () => allerOnglet('carte')],
    ['Troupeau', 'pets', 'troupeau vaches vache genisse genisses veau veaux taureau taureaux bovins', () => allerOnglet('vaches')],
    ['Bêtes parties (ventes, boucherie, morts)', 'logout', 'parties partis sorties sortie ventes vente vendues vendus boucherie mortes morts equarrissage historique ede', () => allerOnglet('vaches', { sorties: true })],
    ['Volailles', 'egg_alt', 'volailles poulets poulet lots lot poulailler marge ic mortalite', () => allerOnglet('volailles')],
    ['Infos notées par la famille', 'edit_note', 'infos notes noter remarque remarques', () => ouvrir(PAGES.ajouts[0], PAGES.ajouts[1])],
    ['À faire (liste de la famille)', 'checklist', 'a faire liste taches tache travaux boulot todo', () => ouvrir(PAGES.a_faire[0], PAGES.a_faire[1])],
    ['Travail des assistants (Claude, GPT)', 'smart_toy', 'assistants claude gpt ia taches en cours ateliers', () => ouvrir(PAGES.taches[0], PAGES.taches[1])],
    ['Nos sources', 'hub', 'sources source site sites maestro mytr ede telepac fermatel pac registre origine chiffres banque compta msa', () => ouvrir(PAGES.sources[0], PAGES.sources[1])]
  ];

  async function vueChercher(el) {
    el.innerHTML = `
      <form class="recherche" id="form-chercher" role="search">
        ${icone('search')}
        <input id="champ-chercher" type="search" autocomplete="off" enterkeyhint="search" placeholder="Numéro, champ, culture, papier…" aria-label="Chercher">
      </form>
      <div id="resultats-chercher"><p class="doux">Chargement…</p></div>`;
    const champ = $('#champ-chercher', el);
    const zone = $('#resultats-chercher', el);
    champ.value = derniereRecherche;
    if (!derniereRecherche) champ.focus();

    const r = await Promise.allSettled([lire('vaches'), lire('champs'), lire('lots'), lire('batiments'), lire('documents', {}), lire('ajouts', { nombre: 100 }), lire('carte'), lire('sorties'), lire('cultures')]);
    const val = (i) => (r[i].status === 'fulfilled' ? r[i].value : null);
    const vaches = val(0) || [], champs = val(1) || [], lots = val(2) || [], bats = (val(3) && val(3).liste) || [];
    const docs = val(4) || [], ajouts = (val(5) || []).filter((x) => x.statut !== 'annule');
    const enTerre = ((val(6) && val(6).features) || []).map((f) => f.properties || {}).filter((p) => p.couche === 'en_terre');

    // Index : un élément par chose qu'on peut retrouver
    const index = [];
    // (les espaces des milliers sont retirés : « 1 905 m² » ne doit pas répondre à « 1 »)
    const ajouter = (groupe, ico, titre, sous, mots, action, numero) => index.push({ groupe, ico, titre, sous,
      texte: sansAccents(titre + ' ' + sous + ' ' + mots).replace(/(\d)[\s  ](?=\d)/g, '$1'), action, numero });
    const fin4 = (n) => String(n || '').replace(/\s/g, '').slice(-4);
    vaches.forEach((v) => {
      const quoi = v.categorie_ede === 'VA' ? 'vache' : v.categorie_ede === 'MA' ? (v.age_mois < 12 ? 'veau mâle' : 'mâle') : (v.age_mois < 12 ? 'velle' : 'génisse');
      ajouter('Bêtes', 'pets', `${v.numero_travail} · ${quoi}`,
        [age(v.age_mois), v.race, v.mere_numero ? 'mère ' + fin4(v.mere_numero) : '', v.groupe_actuel ? v.groupe_actuel.split(':')[0] : ''].filter(Boolean).join(' · '),
        `${String(v.numero_national || '').replace(/\s/g, '')} ${v.age_mois < 12 ? 'veau veaux' : ''} ${v.groupe_actuel || ''}`,
        () => ouvrirVache(v.numero_national), String(v.numero_travail || ''));
    });
    // Bêtes déjà parties (historique EDE depuis 2017), après les bêtes présentes
    const presents = new Set(vaches.map((v) => String(v.numero_national || '').replace(/\s/g, '')));
    ((val(7) && val(7).liste) || []).forEach((x) => {
      if (presents.has(x.n)) return;
      ajouter('Bêtes parties', 'logout', `${x.t} · ${quoiBete(x.a, x.s, moisEntre(x.dn, x.ds))}`,
        majuscule(phraseSortie(x.c, x.v, x.s, x.ds)), `${x.n} partie parti sortie ${motSortie(x.c)}`, () => ouvrirVache(x.n), String(x.t || ''));
    });
    enTerre.forEach((p) => ajouter('Ce qui pousse maintenant', 'grass', `${majuscule(p.culture || '')} · ${p.nom || ''}`,
      (p.surface_m2 ? surfaceTexte(p.surface_m2) + ' · ' : '') + 'semé pour la récolte qui vient' + (p.statut === 'a_confirmer' ? ' (à confirmer)' : ''),
      `${p.code_culture || ''} en terre seme semis`, () => allerOnglet('carte', { code: p.code_culture })));
    champs.forEach((c) => {
      const cult = (c.cultures || []).map((k) => k.culture).join(', ');
      ajouter('Champs', 'landscape', majuscule(c.nom), `${nf(c.ha, 2)} ha${cult ? ' · PAC ' + c.annee + ' : ' + cult : ''}`,
        'champ champs parcelle ' + (c.cultures || []).map((k) => k.code).join(' '), () => ouvrirChamp(c.parcelle_id));
    });
    // Une culture : un raccourci vers la carte, en jaune
    const cultures = new Map();
    champs.forEach((c) => (c.cultures || []).forEach((k) => { if (k.code && !cultures.has(k.code)) cultures.set(k.code, k.culture); }));
    enTerre.forEach((p) => { if (p.code_culture && !cultures.has(p.code_culture)) cultures.set(p.code_culture, p.culture); });
    cultures.forEach((nom, code) => ajouter('Sur la carte', 'map', `Voir « ${nom} » sur la carte`, 'en jaune sur la photo', code, () => allerOnglet('carte', { code })));
    // Numéros PAC (îlot.parcelle, ex. « 80.4 ») : ouvre le champ s'il est connu, sinon la carte centrée dessus
    const champParNom = new Map(champs.map((c) => [sansAccents(c.nom), c]));
    ((val(8) && val(8).parcelles) || []).forEach((p) => {
      if (!p.ilot || !p.numero_parcelle) return;
      const ref = `${p.ilot}.${p.numero_parcelle}`;
      const ch = champParNom.get(sansAccents(p.parcelle));
      ajouter('Champs', 'tag', `PAC ${ref} · ${majuscule(p.parcelle || '')}`, `${p.culture || ''}${p.surface_ha ? ' · ' + nf(p.surface_ha, 2) + ' ha' : ''} · déclaration PAC ${val(8).annee || ''}`,
        `${ref} ${p.ilot}-${p.numero_parcelle} ilot ${p.ilot} parcelle ${p.numero_parcelle} pac telepac`,
        () => (ch ? ouvrirChamp(ch.parcelle_id) : allerOnglet('carte', { cible: { nom: p.parcelle } })), ref);
    });
    // Sapinières, terres du GAEC, propriétés : noms avec références cadastrales (ex. « H 1021 », « D 116 »)
    const COUCHES_CHERCHEES = { sapinieres: ['forest', 'Sapinière'], terres_gaec: ['landscape', 'Terre du GAEC'], proprietes_famille: ['home_work', 'Propriété de la famille'] };
    ((val(6) && val(6).features) || []).forEach((f) => {
      const p = f.properties || {};
      const c = COUCHES_CHERCHEES[p.couche];
      if (!c || !p.nom) return;
      ajouter('Sur la carte', c[0], majuscule(p.nom), [c[1], p.surface_m2 ? surfaceTexte(p.surface_m2) : '', p.statut === 'projet' ? 'projet' : ''].filter(Boolean).join(' · '),
        `${p.couche} ${c[1]} cadastre sapin sapins ${String(p.nom).replace(/\s+/g, "")}`, () => allerOnglet('carte', { cible: { nom: p.nom, couche: p.couche } }));
    });
    lots.forEach((l) => {
      const fini = l.poids_moyen_kg != null;
      ajouter('Lots de volailles', 'egg_alt', `${batNom(l.batiment)} · ${dateFr(l.date_mep)}`,
        `${l.production || ''}${fini ? ` · ${nf(l.marge_eur_m2, 1)} €/m² PA · IC ${nf(l.indice_consommation, 2)}${bilanProvisoire(l) ? ' · provisoire' : ''}` : ' · en cours'}`,
        `${String(l.batiment || '').replace('gaec-denis-', '')} lot lots poulets ${l.numero_lot || ''} ${refLot(l)} ${fini ? '' : 'en cours actuel'}`,
        () => ouvrir('Lot', (e2) => vueLot(e2, l.lot_id)));
    });
    bats.forEach((b) => ajouter('Bâtiments et maisons', b.type === 'maison' ? 'home' : 'home_work', b.nom,
      [typeBatiment(b.type)[0], b.sci ? 'SCI' : '', b.surface_m2 ? nf(b.surface_m2) + ' m² au sol' : ''].filter(Boolean).join(' · '),
      `batiment ${b.type || ''} ${b.sci ? 'sci location' : ''}`, () => ouvrirBatiment(b.objet_id)));
    docs.forEach((d) => ajouter('Papiers', iconeDoc(d), d.titre || 'Document',
      [categorieDoc(d.categorie)[1], d.date_document ? dateFr(d.date_document) : '', d.rattache_libelle].filter(Boolean).join(' · '),
      `papier document ${d.remarque || ''} ${d.auteur || ''}`, () => ouvrirDocument(d, invaliderDocs)));
    ajouts.forEach((x) => ajouter('Infos notées', iconeFait(x.type), x.resume || nomFait(x.type),
      `${nomFait(x.type)} · ${x.auteur || ''} · ${dateFr(x.date_evenement || String(x.cree_le).slice(0, 10))}`,
      `${x.atelier || ''} ${x.numero_animal || ''}`, () => (x.numero_animal ? ouvrirVache(x.numero_animal) : ouvrir(PAGES.ajouts[0], PAGES.ajouts[1]))));
    PAGES_RECHERCHE.forEach(([titre, ico, mots, action]) => ajouter('Pages', ico, titre, '', mots, action));

    const ORDRE = ['Bêtes', 'Bêtes parties', 'Ce qui pousse maintenant', 'Sur la carte', 'Champs', 'Lots de volailles', 'Bâtiments et maisons', 'Papiers', 'Infos notées', 'Pages'];
    const ouverts = new Set();
    const exemple = (vaches.find((v) => v.categorie_ede === 'VA') || {}).numero_travail;
    const dessiner = () => {
      const q = champ.value.trim();
      derniereRecherche = q;
      const mots = sansAccents(q).split(/\s+/).filter(Boolean);
      if (!mots.length) {
        zone.innerHTML = `<div class="bloc"><h2>${icone('tips_and_updates')}Que chercher ?</h2>
          <p class="doux" style="margin-top:0">Un numéro de bête, un champ, une culture, un poulailler, une maison, un papier… Exemples :</p>
          <div class="puces" style="flex-wrap:wrap">${[exemple, 'triticale', 'poulailler 1', 'Lestrezec', 'facture'].filter(Boolean).map((s) => `<button class="puce" data-exemple="${esc(s)}">${esc(s)}</button>`).join('')}</div></div>`;
        $$('[data-exemple]', zone).forEach((b) => b.addEventListener('click', () => { champ.value = b.dataset.exemple; dessiner(); }));
        return;
      }
      const qNum = /^\d+$/.test(q) ? q : null;
      // Un petit nombre (« 1 » dans « poulailler 1 ») doit être un nombre entier, pas un morceau de « 1905 m² » ;
      // un numéro de bête en cours de frappe (« 04 » pour 0412) reste trouvé.
      const motTrouve = (x, m) => (/^\d{1,3}$/.test(m)
        ? new RegExp('(^|\\D)' + m + '(\\D|$)').test(x.texte) || (x.numero && x.numero.startsWith(m))
        : x.texte.includes(m));
      const trouves = index.filter((x) => mots.every((m) => motTrouve(x, m))).map((x) => {
        let score = 1;
        if (qNum && x.numero) score = x.numero === qNum ? 100 : x.numero.startsWith(qNum) ? 50 : x.numero.includes(qNum) ? 30 : 5;
        else if (sansAccents(x.titre).includes(sansAccents(q))) score = 20;
        return Object.assign({ score }, x);
      });
      if (!trouves.length) {
        zone.innerHTML = `<div class="bloc"><h2>${icone('search_off')}Rien trouvé</h2><p class="doux" style="margin:0">Essaie un autre mot, ou pose la question à l'IA dans « Discuter ».</p></div>`;
        return;
      }
      const groupes = ORDRE.map((g) => ({ g, liste: trouves.filter((x) => x.groupe === g).sort((a, b) => b.score - a.score) })).filter((x) => x.liste.length);
      // Les bêtes d'abord si on a tapé un numéro, sinon le groupe qui a le meilleur résultat
      groupes.sort((a, b) => b.liste[0].score - a.liste[0].score || ORDRE.indexOf(a.g) - ORDRE.indexOf(b.g));
      const MAX = 6;
      const actions = [];
      zone.innerHTML = groupes.map(({ g, liste }) => {
        const montres = ouverts.has(g) ? liste : liste.slice(0, MAX);
        return `<div class="bloc"><h2>${esc(g)} <span class="doux" style="font-weight:500">· ${nf(liste.length)}</span></h2><ul class="liste">
          ${montres.map((x) => { actions.push(x.action); return `<li><button data-resultat="${actions.length - 1}"><span class="ico-resultat">${icone(x.ico)}</span>
            <span class="g"><b>${esc(x.titre)}</b>${x.sous ? `<span class="doux">${esc(x.sous)}</span>` : ''}</span></button></li>`; }).join('')}</ul>
          ${liste.length > montres.length ? `<button class="bouton-discret" data-plus="${esc(g)}" style="margin-top:8px">Voir les ${nf(liste.length - montres.length)} autres</button>` : ''}</div>`;
      }).join('');
      $$('[data-resultat]', zone).forEach((b) => b.addEventListener('click', () => { champ.blur(); actions[Number(b.dataset.resultat)](); }));
      $$('[data-plus]', zone).forEach((b) => b.addEventListener('click', () => { ouverts.add(b.dataset.plus); dessiner(); }));
    };
    champ.addEventListener('input', () => { ouverts.clear(); dessiner(); });
    $('#form-chercher', el).addEventListener('submit', (ev) => { ev.preventDefault(); champ.blur(); });
    dessiner();
  }

  // =====================================================================
  // Volailles
  // =====================================================================
  // Référence d'un lot avec le logiciel qui l'a numéroté (les numéros Maestro et Fermatel ne se suivent pas)
  const refLot = (l) => { const id = String(l.lot_id || ''); return !l.numero_lot ? '' : id.startsWith('maestro-') ? 'Maestro n° ' + l.numero_lot : id.startsWith('fermatel-') ? 'Fermatel n° ' + l.numero_lot : 'n° ' + l.numero_lot; };
  let filtreBat = 'tous';
  let filtreProd = 'toutes';

  async function vueVolailles(el) {
    const lots = await lire('lots');
    const bats = Array.from(new Set(lots.map((l) => l.batiment).filter(Boolean))).sort();
    const prods = Array.from(new Set(lots.map((l) => l.production).filter(Boolean))).sort();
    const enCours = lotsEnCours(lots);

    el.innerHTML = `
      ${enCours.length ? `<div class="bloc"><h2>${icone('egg_alt')}En cours</h2><div class="fil-alertes">
        ${enCours.map((l) => ligneLotEnCours(l, lots, `data-lot="${esc(l.lot_id)}"`)).join('')}</div></div>` : ''}
      <div class="bloc">
        <h2>${icone('calendar_month')}Résultats par année</h2>
        <div id="tableau-annees"></div>
        <p class="note">Chaque chiffre de lot est recopié de son bilan (Fermatel, puis « Bilan GTE » de Maestro), sans recalcul ; pas encore validé. Les lignes par année sont une moyenne simple faite par l'appli. Marge PA = marge poussin-aliment. Mort. éco = mortalité économique du bilan : ce n'est pas le nombre de morts ramassés, et elle peut être négative. Les lots « prov. » (bilan provisoire) et « en cours » ne sont pas comptés dans la moyenne.</p>
      </div>
      <div class="puces">
        <button class="puce${filtreBat === 'tous' ? ' actif' : ''}" data-bat="tous">Tous les bâtiments</button>
        ${bats.map((b) => `<button class="puce${filtreBat === b ? ' actif' : ''}" data-bat="${esc(b)}">${esc(batNom(b))}</button>`).join('')}
      </div>
      <div class="puces">
        <button class="puce${filtreProd === 'toutes' ? ' actif' : ''}" data-prod="toutes">Toutes productions</button>
        ${prods.map((p) => `<button class="puce${filtreProd === p ? ' actif' : ''}" data-prod="${esc(p)}">${esc(p)}</button>`).join('')}
      </div>
      <div id="liste-lots"></div>
      <p class="note">Résultats tirés des bilans éleveurs et de Maestro, pas encore validés. La litière, le gaz et le lavage ne sont pas tous comptés.</p>`;

    const dessiner = () => {
      const liste = lots.filter((l) => (filtreBat === 'tous' || l.batiment === filtreBat) && (filtreProd === 'toutes' || l.production === filtreProd));
      // Tableau par année
      const parAn = {};
      liste.forEach((l) => { const an = l.date_mep ? l.date_mep.slice(0, 4) : '?'; (parAn[an] = parAn[an] || []).push(l); });
      const moy = (arr, k) => { const v = arr.map((x) => x[k]).filter((x) => x != null).map(Number); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
      const annees = Object.keys(parAn).sort().reverse();
      $('#tableau-annees', el).innerHTML = `<table><thead><tr><th>Année</th><th>Lots finis</th><th>Marge PA €/m²</th><th>IC</th><th>Mort. éco %</th></tr></thead><tbody>
        ${annees.map((an) => {
          const finis = parAn[an].filter((x) => x.poids_moyen_kg != null);
          const t = finis.filter((x) => !bilanProvisoire(x)); // les bilans provisoires ne comptent pas dans la moyenne
          const prov = finis.length - t.length, enCoursAn = parAn[an].length - finis.length;
          const plus = [prov ? `+${prov} prov.` : '', enCoursAn ? `+${enCoursAn} en cours` : ''].filter(Boolean).join(' · ');
          return `<tr><td>${esc(an)}</td><td>${nf(t.length)}${plus ? `<br><span class="doux">${esc(plus)}</span>` : ''}</td><td>${nf(moy(t, 'marge_eur_m2'), 1)}</td><td>${nf(moy(t, 'indice_consommation'), 2)}</td><td>${nf(moy(t, 'mortalite_pct'), 1)}</td></tr>`;
        }).join('')}
      </tbody></table>`;
      // Liste
      $('#liste-lots', el).innerHTML = annees.map((an) => `
        <div class="bloc"><h2>${esc(an)} <span class="doux" style="font-weight:500">· ${pluriel(parAn[an].length, 'lot')}</span></h2><ul class="liste">${parAn[an].map((l) => `
          <li><button data-lot="${esc(l.lot_id)}">
            <span class="g"><b>${esc(batNom(l.batiment))} · ${esc(dateFr(l.date_mep, true))}</b>
            <span class="doux">${esc(l.production || '')}</span></span>
            <span class="d">${l.poids_moyen_kg != null ? `${nf(l.marge_eur_m2, 1)} €/m² <span class="doux">PA</span><br><span class="doux">IC ${nf(l.indice_consommation, 2)}${bilanProvisoire(l) ? " · provisoire" : ""}</span>` : '<span class="etiquette">en cours</span>'}</span>
          </button></li>`).join('')}</ul></div>`).join('') || '<div class="bloc"><p class="doux">Aucun lot pour ces filtres.</p></div>';
      $$('[data-lot]', el).forEach((bt) => bt.addEventListener('click', () => ouvrir('Lot', (e2) => vueLot(e2, bt.dataset.lot))));
    };
    $$('[data-bat]', el).forEach((bt) => bt.addEventListener('click', () => { filtreBat = bt.dataset.bat; $$('[data-bat]', el).forEach((x) => x.classList.toggle('actif', x === bt)); dessiner(); }));
    $$('[data-prod]', el).forEach((bt) => bt.addEventListener('click', () => { filtreProd = bt.dataset.prod; $$('[data-prod]', el).forEach((x) => x.classList.toggle('actif', x === bt)); dessiner(); }));
    dessiner();
    $$('.fil-alertes [data-lot]', el).forEach((bt) => bt.addEventListener('click', () => ouvrir('Lot', (e2) => vueLot(e2, bt.dataset.lot))));
  }

  // [clé, libellé, décimales, sens : +1 = plus haut c'est mieux, -1 = plus bas c'est mieux, 0 = neutre]
  const INDICATEURS_LOT = [
    ['poids_moyen_kg', 'Poids moyen (kg)', 2, 1], ['gmq_g_j', 'Croissance (g/jour)', 0, 1], ['indice_consommation', 'Indice de consommation', 2, -1],
    ['mortalite_pct', 'Mortalité économique (%)', 2, -1], ['saisies_pct', 'Saisies (%)', 2, -1], ['age_moyen_j', "Âge à l'enlèvement (jours)", 0, 0],
    ['aliment_kg_par_tete', 'Aliment par tête (kg)', 2, 0], ['densite_animaux_m2', 'Densité (animaux/m²)', 1, 0], ['marge_eur_m2', 'Marge poussin-aliment (€/m²)', 2, 1],
    ['marge_eur_par_piece', 'Marge poussin-aliment (€/animal)', 3, 1], ['ventes_eur', 'Ventes (€)', 0, 0], ['aliment_eur', 'Aliment (€)', 0, 0], ['net_a_payer_eur', 'Net à payer (€)', 0, 0]
  ];
  const GRAPH_INDICATEURS = [
    ['marge_eur_m2', 'Marge PA €/m²', 2, '€/m²'], ['indice_consommation', 'Indice de conso.', 2, ''], ['mortalite_pct', 'Mort. éco %', 2, '%'],
    ['poids_moyen_kg', 'Poids kg', 2, 'kg'], ['gmq_g_j', 'Croissance g/j', 0, 'g/j']
  ];

  // Libellés des mesures détaillées d'un lot, rangées par rubrique
  const RUBRIQUES = [
    ['Croissance et poids', 'monitor_weight', /^(poids|gmq|age)_/],
    ['Santé et qualité', 'health_and_safety', /^(mortalite|taux_saisie)/],
    ['Mise en place', 'egg', /^(densite_mep|poussins_achetes|animaux_livres|prix_poussin|achat_poussins|sexage)/],
    ['Aliment', 'grain', /^(aliment|consommation_par_tete|ict|ip$)/],
    ['Ventes', 'sell', /^vente_/],
    ['Primes et suppléments', 'paid', /^(prime_|bonus|supplement|complement|compensation|grille_qualite|aide_batiment)/],
    ['Retenues et charges', 'receipt_long', /^(malus|cotisation|prelevement|autres_achats|vaccin|gavage|manitou|total_)/],
    ['Résultat', 'euro', /^(marge|net_a_payer|solde|montant|base_ht|tva|acompte)/]
  ];
  const NOMS_MESURES = {
    poids_moyen: 'Poids moyen', poids_femelle: 'Poids femelles', poids_male: 'Poids mâles', gmq_moyen: 'Croissance moyenne', gmq_femelle: 'Croissance femelles', gmq_male: 'Croissance mâles',
    age_moyen: 'Âge moyen', age_femelle: 'Âge femelles', age_male: 'Âge mâles', poids_total_m2: 'Poids total au m²', poids_femelle_m2: 'Poids femelles au m²', poids_male_m2: 'Poids mâles au m²',
    mortalite_economique_moyenne: 'Mortalité économique moyenne', mortalite_economique_femelle: 'Mortalité économique femelles', mortalite_economique_male: 'Mortalité économique mâles',
    taux_saisie_moyen: 'Saisies moyennes', taux_saisie_femelle: 'Saisies femelles', taux_saisie_male: 'Saisies mâles',
    densite_mep_totale: 'Densité totale', densite_mep_femelle: 'Densité femelles', densite_mep_male: 'Densité mâles',
    consommation_par_tete: 'Aliment par tête', ict: 'Indice de consommation', ip: 'Indice de performance', aliment_consomme_kg: 'Aliment consommé',
    aliment_montant_eur: 'Montant aliment', aliment_prix_unitaire: 'Prix de l\'aliment', aliment_incidence_tonnage_eur: 'Incidence tonnage',
    marge_pa_m2: 'Marge poussin-aliment au m²', marge_pa_par_piece: 'Marge poussin-aliment par animal', marge_pa_par_tonne: 'Marge poussin-aliment par tonne', net_a_payer_eur: 'Net à payer'
  };
  const nomMesure = (k) => NOMS_MESURES[k] || (k.charAt(0).toUpperCase() + k.slice(1)).replace(/_eur$/, '').replace(/_nb$/, ' (nombre)').replace(/_t$/, ' (t)').replace(/_/g, ' ');

  // ---------------------------------------------------------------------
  // Suivi jour par jour d'un lot (registre MyTR) comparé aux lots d'avant du même poulailler, au même âge
  // ---------------------------------------------------------------------
  const isoAujourdhui = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const ecartPct = (v, ref) => (v == null || !ref ? null : Math.round(((Number(v) - Number(ref)) / Number(ref)) * 100));
  const texteEcart = (p) => (p === null ? '' : p === 0 ? 'comme d\'habitude' : (p > 0 ? '+' : '−') + Math.abs(p) + ' %');
  function suiviLot(l, detail) {
    const rel = ((detail && detail.releves) || []).map((x) => Object.assign({}, x, { j: Number(x.j) }));
    if (!rel.length) return null;
    const refs = {}; ((detail && detail.reference) || []).forEach((x) => { refs[Number(x.j)] = x; });
    const eff = detail && detail.effectif ? Number(detail.effectif) : null;
    const enCours = l.poids_moyen_kg == null && !l.date_fin;
    // Le jour en cours n'est pas fini : on regarde le dernier jour complet
    const complets = rel.filter((x) => !(enCours && String(x.date).slice(0, 10) >= isoAujourdhui()));
    const d = complets[complets.length - 1] || null;
    const r = d ? refs[d.j] || {} : {};
    const parPoulet = (v, f) => (v == null || !eff ? null : Math.round((Number(v) * f) / eff));
    const eauMl = d ? parPoulet(d.eau, 1000) : null, alimG = d ? parPoulet(d.alim, 1000) : null;
    const ecarts = d ? {
      eau: ecartPct(eauMl, r.eau_ml), alim: ecartPct(alimG, r.alim_g),
      pm: ecartPct(d.pm, d.om), pf: ecartPct(d.pf, d.of)
    } : {};
    // Seuils validés par Hugo le 18/11/2026 :
    // eau ±15 % deux jours de suite (−30 % sur un seul jour = alerte tout de suite) ;
    // aliment −15 % deux jours de suite ; poids −10 % sous l'objectif à partir du jour 14.
    const alertes = [];
    if (d && enCours) {
      const p = complets[complets.length - 2] || null;
      const rp = p ? refs[p.j] || {} : {};
      const eauP = p && p.j === d.j - 1 ? ecartPct(parPoulet(p.eau, 1000), rp.eau_ml) : null;
      const alimP = p && p.j === d.j - 1 ? ecartPct(parPoulet(p.alim, 1000), rp.alim_g) : null;
      const deuxJours = (a, b, test) => a !== null && b !== null && test(a) && test(b);
      if (ecarts.eau !== null && ecarts.eau <= -30) alertes.push(`Eau d'hier très basse (${texteEcart(ecarts.eau)} par poulet) : vérifier l'arrivée d'eau`);
      else if (deuxJours(ecarts.eau, eauP, (x) => x <= -15)) alertes.push(`Eau plus basse que d'habitude deux jours de suite (${texteEcart(eauP)} puis ${texteEcart(ecarts.eau)} par poulet)`);
      if (deuxJours(ecarts.eau, eauP, (x) => x >= 15)) alertes.push(`Eau plus haute que d'habitude deux jours de suite (${texteEcart(eauP)} puis ${texteEcart(ecarts.eau)} par poulet)`);
      if (deuxJours(ecarts.alim, alimP, (x) => x <= -15)) alertes.push(`Aliment plus bas que d'habitude deux jours de suite (${texteEcart(alimP)} puis ${texteEcart(ecarts.alim)} par poulet)`);
      if (d.j >= 14 && ((ecarts.pm !== null && ecarts.pm <= -10) || (ecarts.pf !== null && ecarts.pf <= -10))) alertes.push('Poids en dessous de l\'objectif de MyTR');
    }
    return { rel, refs, eff, enCours, d, r, eauMl, alimG, ecarts, alertes };
  }

  // Courbes par jour d'âge : séries [{ nom, couleur, tirets, points: [[jour, valeur]] }]
  function courbeJours(series, o) {
    const L = 340, H = 190, mg = { g: 40, d: 8, h: 12, b: 24 };
    // Lot en cours : on ne montre que les jours utiles (jusqu'à une semaine après aujourd'hui)
    if (o && o.jMax) series = series.map((s) => Object.assign({}, s, { points: s.points.filter((p) => p[0] <= o.jMax) }));
    const tous = series.flatMap((s) => s.points.filter((p) => p[1] != null && !isNaN(p[1])));
    if (!tous.length) return '<p class="doux">Pas de relevé pour ce choix.</p>';
    const jMax = (o && o.jMax) || Math.max(...tous.map((p) => p[0]), 1), vMax = Math.max(...tous.map((p) => p[1])) * 1.08 || 1;
    const vMin = o && o.depuisZero === false ? Math.min(...tous.map((p) => p[1])) * 0.95 : 0;
    const x = (j) => mg.g + (j / jMax) * (L - mg.g - mg.d), y = (v) => H - mg.b - ((v - vMin) / (vMax - vMin || 1)) * (H - mg.h - mg.b);
    const pas = vMax - vMin > 2000 ? 1000 : vMax - vMin > 400 ? 200 : vMax - vMin > 100 ? 50 : vMax - vMin > 20 ? 10 : 5;
    let grille = '';
    for (let v = Math.ceil(vMin / pas) * pas; v <= vMax; v += pas) grille += `<line class="grille" x1="${mg.g}" x2="${L - mg.d}" y1="${y(v)}" y2="${y(v)}"/><text x="${mg.g - 4}" y="${y(v) + 4}" text-anchor="end">${nf(v)}</text>`;
    for (let j = 0, pasJ = jMax <= 21 ? 2 : 7; j <= jMax; j += pasJ) grille += `<text x="${x(j)}" y="${H - 6}" text-anchor="middle">${j}</text>`;
    const lignes = series.map((s) => {
      const pts = s.points.filter((p) => p[1] != null && !isNaN(p[1]));
      if (!pts.length) return '';
      return `<polyline fill="none" stroke="${s.couleur}" stroke-width="${s.epais || 2}" stroke-linejoin="round" stroke-linecap="round"${s.tirets ? ` stroke-dasharray="${s.tirets}"` : ''} points="${pts.map((p) => x(p[0]).toFixed(1) + ',' + y(p[1]).toFixed(1)).join(' ')}"/>`
        + (s.dernier ? `<circle cx="${x(pts[pts.length - 1][0])}" cy="${y(pts[pts.length - 1][1])}" r="4" fill="${s.couleur}" stroke="var(--carte)" stroke-width="2"/>` : '');
    }).join('');
    // Zones à toucher : une par jour
    let zones = '';
    for (let j = 0; j <= jMax; j++) zones += `<rect class="zone-jour" data-j="${j}" x="${x(j) - (L - mg.g - mg.d) / jMax / 2}" y="${mg.h}" width="${(L - mg.g - mg.d) / jMax}" height="${H - mg.h - mg.b}" fill="transparent"/>`;
    return `<svg class="graph" viewBox="0 0 ${L} ${H}" role="img" aria-label="${esc(o && o.titre || 'courbe')}">${grille}${lignes}<line class="repere-jour" x1="0" x2="0" y1="${mg.h}" y2="${H - mg.b}" stroke="var(--texte-faible)" stroke-width="1" visibility="hidden"/>${zones}</svg>
      <div class="legende-graph">${series.filter((s) => s.points.some((p) => p[1] != null)).map((s) => `<span><i style="${s.tirets ? `background:none;border-top:2px dashed ${s.couleur};height:0;width:16px;border-radius:0;vertical-align:4px` : `background:${s.couleur}`}"></i>${esc(s.nom)}</span>`).join('')}</div>`;
  }

  async function vueLot(el, lotId) {
    const [lots, detail] = await Promise.all([lire('lots'), lire('lot', { lot_id: lotId })]);
    const l = lots.find((x) => x.lot_id === lotId);
    if (!l) { el.innerHTML = '<div class="bloc"><p>Lot introuvable.</p></div>'; return; }
    titrePage(el, batNom(l.batiment) + ' · ' + dateFr(l.date_mep));

    const precedents = lots
      .filter((x) => x.lot_id !== l.lot_id && x.production === l.production && x.poids_moyen_kg != null && x.date_mep && l.date_mep && x.date_mep < l.date_mep)
      .sort((a, b) => (a.date_mep < b.date_mep ? 1 : -1)).slice(0, 10);
    const moyenne = (k) => { const v = precedents.map((x) => x[k]).filter((x) => x != null).map(Number); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
    const enCours = l.poids_moyen_kg == null;

    let tableau = '';
    if (!enCours && precedents.length) {
      tableau = `<table><thead><tr><th></th><th>Ce lot</th><th>Moyenne</th><th>Écart</th></tr></thead><tbody>
        ${INDICATEURS_LOT.map(([k, lib, d, sens]) => {
          const v = l[k]; const m = moyenne(k);
          if (v === null || v === undefined) return '';
          let ecart = '', cls = '';
          if (m !== null) {
            const diff = Number(v) - m;
            ecart = (diff > 0 ? '+' : '') + nf(diff, d);
            if (sens !== 0 && Math.abs(diff) > Math.abs(m) * 0.005) cls = (diff * sens > 0) ? 'mieux' : 'moins';
          }
          return `<tr><td>${esc(lib)}</td><td>${nf(v, d)}</td><td>${m === null ? '—' : nf(m, d)}</td><td class="${cls}">${ecart}</td></tr>`;
        }).join('')}</tbody></table>
        <p class="note">${precedents.length > 1 ? `Moyenne des ${precedents.length} lots ${esc(l.production || '')} précédents.` : `Comparé au lot ${esc(l.production || '')} précédent.`} Vert : mieux ; rouge : moins bien.</p>`;
    } else if (!enCours) {
      tableau = '<p class="doux">Pas de lot plus ancien de la même production pour comparer.</p>';
    }

    // Lots d'avant de la même production, ce lot toujours en dernier (même si l'autre poulailler a démarré le même jour)
    const serie = lots.filter((x) => x.production === l.production && x.poids_moyen_kg != null && x.date_mep && l.date_mep
        && (x.date_mep < l.date_mep || x.lot_id === l.lot_id))
      .sort((a, b) => (a.date_mep < b.date_mep ? -1 : a.date_mep > b.date_mep ? 1 : 0)).slice(-11); // ce lot + les 10 d'avant (mêmes lots que le tableau)
    const dateEnlevement = !l.date_fin && l.date_mep && l.age_moyen_j != null
      ? new Date(new Date(l.date_mep + 'T12:00:00').getTime() + Number(l.age_moyen_j) * 86400000).toISOString().slice(0, 10) : null;
    const SOURCES_CHIFFRES = { extrait_du_bilan_non_valide: 'bilans Fermatel', extrait_rubrique_maestro_non_valide: 'rubriques Maestro' };

    // Départs à l'abattoir (relevés) ou, pour un lot en cours, estimés d'après les lots précédents
    const departs = (detail && detail.departs) || [];
    const ah = agesHabituels(lots, l.production);
    const sexeTxt = (s) => (s === 'F' ? 'femelles' : s === 'M' ? 'mâles' : (s || ''));
    const abattoirCourt = (a) => String(a || '').replace(/^SAS\s+/i, '').replace(/^LES\s+/i, '').toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
    const blocDeparts = departs.length
      ? `<div class="bloc"><h2>${icone('local_shipping')}${departs.length > 1 ? pluriel(departs.length, 'départ') : 'Départ'} à l'abattoir</h2>
          ${departs.map((d) => ligne(`<b>${esc(dateFr(d.date))}</b> <span class="doux">· jour ${nf(d.age_j)}</span><br><span class="doux">${esc(sexeTxt(d.sexe))} · ${esc(abattoirCourt(d.abattoir))}</span>`,
            `${nf(d.nb)}<br><span class="doux">${d.poids_t != null ? nf(d.poids_t, 1) + ' t' : ''}</span>`)).join('')}
          <p class="note">Recopié des résultats d'abattage (Fermatel) ou des enlèvements de Maestro.</p></div>`
      : enCours && ah.departs ? `<div class="bloc"><h2>${icone('local_shipping')}Départs prévus</h2>
          ${ah.departs.map((j, i) => ligne(`<b>≈ ${esc(datePlusJours(l.date_mep, j))}</b> <span class="doux">· jour ${nf(j)}</span>`, esc(i === ah.departs.length - 1 ? 'mâles' : 'femelles'))).join('')}
          <p class="note">Calcul : moyenne des ${nf(ah.nbLots)} derniers lots ${esc(l.production || '')} à 3 départs. Les vraies dates sont fixées avec Maestro.</p></div>` : '';

    // Poussins mis en place et suivi jour par jour (registre MyTR)
    const nbMesure = (k) => { const m = ((detail && detail.mesures) || []).find((x) => x.indicateur === k); return m ? Number(m.valeur) : null; };
    const effectif = detail && detail.effectif ? Number(detail.effectif) : null;
    const males = nbMesure('animaux_livres_males_nb') ?? nbMesure('poussins_achetes_male_nb');
    const femelles = nbMesure('animaux_livres_femelles_nb') ?? nbMesure('poussins_achetes_femelle_nb');
    const suivi = suiviLot(l, detail);
    const ONGLETS_SUIVI = suivi ? [
      ['eau', suivi.eff ? 'Eau par poulet' : 'Eau'],
      suivi.rel.some((x) => x.alim) ? ['alim', suivi.eff ? 'Aliment par poulet' : 'Aliment'] : null,
      suivi.rel.some((x) => x.pm || x.pf) ? ['poids', 'Poids'] : null,
      suivi.rel.some((x) => x.tin != null) ? ['temp', 'Température'] : null
    ].filter(Boolean) : [];
    const blocSuivi = !suivi ? '' : `<div class="bloc">
        <h2>${icone('monitoring')}Suivi jour par jour</h2>
        ${suivi.d && suivi.enCours ? `
          <p class="doux" style="margin-top:0">Dernier jour complet : <b>jour ${nf(suivi.d.j)}</b> (${esc(dateFr(String(suivi.d.date).slice(0, 10)))})</p>
          ${suivi.alertes.length ? `<div class="fil-alertes" style="margin-bottom:10px">${suivi.alertes.map((a) => `<div class="alerte-ligne attention">${icone('warning')}<span class="txt"><b>${esc(a)}</b></span></div>`).join('')}</div>` : ''}
          <div class="chiffres">
            ${suivi.d.eau != null ? `<div class="chiffre"><b>${nf(suivi.d.eau)} L</b><span>eau${suivi.eauMl != null ? ` · ${nf(suivi.eauMl)} ml/poulet` : ''}${suivi.ecarts.eau !== null ? `<br>${esc(texteEcart(suivi.ecarts.eau))} / lots d'avant` : ''}</span></div>` : ''}
            ${suivi.d.alim != null ? `<div class="chiffre"><b>${nf(suivi.d.alim)} kg</b><span>aliment${suivi.alimG != null ? ` · ${nf(suivi.alimG)} g/poulet` : ''}${suivi.ecarts.alim !== null ? `<br>${esc(texteEcart(suivi.ecarts.alim))} / lots d'avant` : ''}</span></div>` : ''}
            ${suivi.d.pm != null || suivi.d.pf != null ? `<div class="chiffre"><b>${nf(suivi.d.pm)} / ${nf(suivi.d.pf)} g</b><span>poids mâles / femelles${suivi.d.om ? `<br>objectif ${nf(suivi.d.om)} / ${nf(suivi.d.of)} g` : ''}</span></div>` : ''}
            ${suivi.d.tin != null ? `<div class="chiffre"><b>${nf(suivi.d.tin, 1)} – ${nf(suivi.d.tix, 1)} °C</b><span>dedans${suivi.d.ten != null ? `<br>dehors ${nf(suivi.d.ten, 1)} – ${nf(suivi.d.tex, 1)} °C` : ''}</span></div>` : ''}
          </div>` : ''}
        <div class="puces" style="margin-top:12px">${ONGLETS_SUIVI.map((x, i) => `<button class="puce${i === 0 ? ' actif' : ''}" data-suivi="${x[0]}">${esc(x[1])}</button>`).join('')}</div>
        <div id="zone-suivi"></div>
        <p class="doux" id="detail-suivi" style="min-height:1.4em;margin:6px 0 0">Touche la courbe pour lire un jour.</p>
        <p class="note">Registre de l'éleveur MyTR (automate du poulailler), relu le ${esc(dateFr(String(detail.releves_le || '').slice(0, 10)))}. « Lots d'avant » : moyenne des derniers lots du même poulailler au même âge${suivi.eff ? `, ramenée par poulet (${nf(suivi.eff)} poussins mis en place)` : ''}. ${l.batiment === 'gaec-denis-p02' ? 'Le poulailler 2 n\'a ni balance ni pesée de l\'aliment dans MyTR. ' : 'Les premiers jours, la balance pèse peu d\'oiseaux. '}Les morts ne sont pas notés jour par jour : la mortalité du lot vient du bilan de fin de lot.</p>
      </div>`;

    // Mesures détaillées par rubrique (les départs ont leur propre bloc)
    const mesures = ((detail && detail.mesures) || []).filter((m) => !/^depart_/.test(m.indicateur));
    const dejaVus = new Set();
    const rubriques = RUBRIQUES.map(([titre, ico, motif]) => {
      const lignes = mesures.filter((m) => !dejaVus.has(m.indicateur) && motif.test(m.indicateur));
      lignes.forEach((m) => dejaVus.add(m.indicateur));
      return { titre, ico, lignes };
    }).filter((r) => r.lignes.length);
    const autres = mesures.filter((m) => !dejaVus.has(m.indicateur));
    if (autres.length) rubriques.push({ titre: 'Autres', ico: 'more_horiz', lignes: autres });
    const decimales = (m) => { const v = Math.abs(Number(m.valeur)); return Number.isInteger(Number(m.valeur)) || v >= 100 ? 0 : v >= 10 ? 1 : 2; };

    el.innerHTML = `
      <div class="bloc fiche-tete">
        <div class="numero-grand" style="font-size:30px">${esc(batNom(l.batiment))}</div>
        <div class="badges"><span class="badge">${esc(l.production || '—')}</span>${refLot(l) ? `<span class="badge">${esc(refLot(l))}</span>` : ''}${enCours ? '<span class="badge vert">en cours</span>' : ''}${bilanProvisoire(l) ? '<span class="badge orange">bilan provisoire</span>' : ''}</div>
        <div class="chiffres" style="margin-top:12px">
          ${enCours ? chiffre(joursDepuis(l.date_mep), 'jours depuis la mise en place') + chiffre(dureeHabituelle(lots, l.production), 'jours en moyenne pour un lot')
            : chiffre(l.marge_eur_m2, 'marge poussin-aliment €/m²' + (bilanProvisoire(l) ? ' (provisoire)' : ''), 2) + chiffre(l.indice_consommation, 'indice de conso.', 2) + chiffre(l.poids_moyen_kg, 'poids moyen (kg)', 2) + chiffre(l.mortalite_pct, 'mortalité économique (%)', 2)}
        </div>
        ${bilanProvisoire(l) ? '<p class="note" style="margin:8px 0">Bilan provisoire : seulement le bilan technique de Maestro, pas encore le bilan avec l\'argent (ventes, aliment, net à payer). Les chiffres peuvent encore changer.</p>' : ''}
        ${ligne('Mise en place', esc(dateFr(l.date_mep)))}
        ${effectif ? ligne('Poussins mis en place', `${nf(effectif)}${males && femelles ? `<br><span class="doux">${nf(males)} mâles, ${nf(femelles)} femelles</span>` : ''}`) : ''}
        ${departs.length ? ligne('Enlèvement', `${departs.length > 1 ? esc(dateFr(departs[0].date, true)) + ' → ' : ''}${esc(dateFr(departs[departs.length - 1].date))}<br><span class="doux">${pluriel(departs.length, 'départ')} à l'abattoir</span>`)
          : l.date_fin ? ligne('Enlèvement', esc(dateFr(l.date_fin)))
          : enCours ? ligne('Enlèvement', ah.departs ? `≈ ${esc(datePlusJours(l.date_mep, ah.departs[0]))} → ${esc(datePlusJours(l.date_mep, ah.departs[ah.departs.length - 1]))}<br><span class="doux">${joursDepuis(l.date_mep) > ah.departs[ah.departs.length - 1] ? 'date estimée passée : départs pas encore relevés' : 'estimation, voir les départs prévus'}</span>` : 'pas d\'estimation')
          : dateEnlevement ? ligne('Enlèvement', `≈ ${esc(dateFr(dateEnlevement))}<br><span class="doux">calcul : mise en place + ${nf(l.age_moyen_j)} jours</span>`) : ''}
        ${l.animaux_vendus != null ? ligne('Animaux vendus', nf(l.animaux_vendus)) : ''}
      </div>
      ${enCours ? blocSuivi : ''}
      ${!enCours && serie.length > 1 ? `<div class="bloc">
        <h2>${icone('bar_chart')}Ce lot dans l'historique</h2>
        <div class="puces">${GRAPH_INDICATEURS.map((g, i) => `<button class="puce${i === 0 ? ' actif' : ''}" data-graph="${g[0]}">${esc(g[1])}</button>`).join('')}</div>
        <div id="zone-graph"></div>
        <p class="doux" id="detail-graph" style="min-height:1.4em;margin:6px 0 0"></p>
        <div class="legende-graph"><span><i style="background:var(--bleu)"></i>ce lot</span><span><i style="background:var(--gris-graph)"></i>lots ${esc(l.production || '')} d'avant</span><span><i class="pointilles"></i>moyenne d'avant</span></div>
      </div>` : ''}
      ${blocDeparts}
      ${enCours ? '' : blocSuivi}
      ${tableau ? `<div class="bloc"><h2>${icone('compare_arrows')}Comparé aux lots d'avant</h2>${tableau}</div>` : ''}
      ${enCours ? `<div class="bloc"><h2>${icone('hourglass_top')}Résultats</h2><p>Lot en cours : les résultats arriveront avec le bilan de fin de lot.</p></div>` : ''}
      ${rubriques.map((r) => `<details class="bloc rubrique"><summary><h2>${icone(r.ico)}${esc(r.titre)} <span class="doux" style="font-weight:500">· ${r.lignes.length}</span></h2></summary>
        ${r.lignes.map((m) => ligne(esc(nomMesure(m.indicateur)), `${nf(m.valeur, decimales(m))} <span class="doux">${esc(m.unite || '')}</span>`)).join('')}</details>`).join('')}
      <div id="docs-lot"></div>
      <button class="bouton-principal" id="noter-lot" style="width:100%;margin-bottom:12px">${icone('add_circle')}Noter une info sur ce lot</button>
      ${detail && detail.documents && detail.documents.length ? `<div class="bloc"><h2>${icone('description')}Sources des chiffres</h2>${detail.documents.map((d) => `<div class="ligne"><div class="g doux">${esc(d.titre)}</div></div>`).join('')}</div>` : ''}
      ${enCours ? '' : `<p class="note">Chiffres extraits ${l.statut_mesures && SOURCES_CHIFFRES[l.statut_mesures] ? 'des ' + esc(SOURCES_CHIFFRES[l.statut_mesures]) : 'des bilans'}, pas encore validés.</p>`}`;
    blocDocuments($('#docs-lot', el), { type: 'lot', id: String(l.lot_id), libelle: batNom(l.batiment) + ' · lot du ' + dateFr(l.date_mep), vide: 'Bilan, bon d\'enlèvement, facture d\'aliment, photo : ajoute-les ici.' });
    $('#noter-lot', el).addEventListener('click', () => noter({ atelier: 'volailles', lot: batNom(l.batiment) + ' · lot du ' + dateFr(l.date_mep) + (refLot(l) ? ' (' + refLot(l) + ')' : ''), libelle: batNom(l.batiment) + ' · lot du ' + dateFr(l.date_mep) }));

    if (suivi && ONGLETS_SUIVI.length) {
      // Jours à tracer : pas le jour en cours (pas fini) ni le dernier jour d'un lot fini s'il est très incomplet
      const relC = suivi.rel.filter((x, i, a) => !(suivi.enCours && String(x.date).slice(0, 10) >= isoAujourdhui())
        && !(!suivi.enCours && i === a.length - 1 && i > 0 && x.eau != null && a[i - 1].eau && Number(x.eau) < Number(a[i - 1].eau) * 0.4));
      const refT = Object.values(suivi.refs).map((x) => Object.assign({}, x, { j: Number(x.j) })).sort((a, b) => a.j - b.j);
      const pp = (v, f) => (v == null ? null : suivi.eff ? (Number(v) * f) / suivi.eff : Number(v));
      const val = (v) => (v == null ? null : Number(v));
      const C = { lot: 'var(--bleu)', avant: 'var(--texte-faible)', obj: 'var(--vert)', fem: 'var(--ambre)' };
      const DEFS = {
        eau: { unite: suivi.eff ? 'ml/poulet' : 'L', series: [
          { nom: 'ce lot', couleur: C.lot, dernier: true, points: relC.map((x) => [x.j, pp(x.eau, 1000)]) },
          suivi.eff ? { nom: 'lots d\'avant', couleur: C.avant, tirets: '5 4', points: refT.map((x) => [x.j, val(x.eau_ml)]) } : null] },
        alim: { unite: suivi.eff ? 'g/poulet' : 'kg', series: [
          { nom: 'ce lot', couleur: C.lot, dernier: true, points: relC.filter((x) => x.alim == null || Number(x.alim) < 12000).map((x) => [x.j, pp(x.alim, 1000)]) },
          suivi.eff ? { nom: 'lots d\'avant', couleur: C.avant, tirets: '5 4', points: refT.map((x) => [x.j, val(x.alim_g)]) } : null] },
        poids: { unite: 'g', series: [
          { nom: 'mâles', couleur: C.lot, dernier: true, points: relC.filter((x) => x.j >= 3).map((x) => [x.j, val(x.pm)]) },
          { nom: 'femelles', couleur: C.fem, dernier: true, points: relC.filter((x) => x.j >= 3).map((x) => [x.j, val(x.pf)]) },
          { nom: 'objectif mâles', couleur: C.lot, tirets: '2 4', points: relC.map((x) => [x.j, val(x.om)]) },
          { nom: 'objectif femelles', couleur: C.fem, tirets: '2 4', points: relC.map((x) => [x.j, val(x.of)]) }] },
        temp: { unite: '°C', dec: 1, depuisZero: false, series: [
          { nom: 'dedans max', couleur: 'var(--rouge)', points: relC.map((x) => [x.j, val(x.tix)]) },
          { nom: 'dedans min', couleur: C.fem, points: relC.map((x) => [x.j, val(x.tin)]) },
          { nom: 'dehors max', couleur: C.avant, tirets: '5 4', points: relC.map((x) => [x.j, val(x.tex)]) },
          { nom: 'dehors min', couleur: C.avant, tirets: '2 3', points: relC.map((x) => [x.j, val(x.ten)]) }] }
      };
      const dessinerSuivi = (k) => {
        const def = DEFS[k];
        const series = def.series.filter(Boolean);
        const dernierJ = relC.length ? relC[relC.length - 1].j : 0;
        $('#zone-suivi', el).innerHTML = courbeJours(series, { titre: k, depuisZero: def.depuisZero, jMax: suivi.enCours ? Math.max(14, dernierJ + 7) : null });
        $('#detail-suivi', el).textContent = 'Touche la courbe pour lire un jour.';
        const rep = $('#zone-suivi .repere-jour', el);
        $$('#zone-suivi .zone-jour', el).forEach((z) => z.addEventListener('click', () => {
          const j = Number(z.dataset.j);
          const cx = Number(z.getAttribute('x')) + Number(z.getAttribute('width')) / 2;
          if (rep) { rep.setAttribute('x1', cx); rep.setAttribute('x2', cx); rep.setAttribute('visibility', 'visible'); }
          const morceaux = series.map((s) => { const p = s.points.find((q) => q[0] === j); return p && p[1] != null ? `${s.nom} ${nf(p[1], def.dec || 0)}` : null; }).filter(Boolean);
          $('#detail-suivi', el).textContent = `Jour ${j} : ${morceaux.length ? morceaux.join(' · ') + ' ' + def.unite : 'pas de relevé'}`;
        }));
      };
      $$('[data-suivi]', el).forEach((b) => b.addEventListener('click', () => {
        $$('[data-suivi]', el).forEach((x) => x.classList.toggle('actif', x === b));
        dessinerSuivi(b.dataset.suivi);
      }));
      dessinerSuivi(ONGLETS_SUIVI[0][0]);
    }

    if (!enCours && serie.length > 1) {
      const dessinerGraph = (cle) => {
        const g = GRAPH_INDICATEURS.find((x) => x[0] === cle);
        const points = serie.map((x) => ({ cle: x.lot_id, valeur: x[cle] == null ? null : Number(x[cle]), lot: x, accent: x.lot_id === l.lot_id }));
        const precedentsVals = points.filter((p) => !p.accent && p.valeur !== null).map((p) => p.valeur);
        $('#zone-graph', el).innerHTML = graphSimple(points, {
          dec: g[2], unite: g[3], accent: true,
          moyenne: precedentsVals.length ? precedentsVals.reduce((s, v) => s + v, 0) / precedentsVals.length : null,
          etiquette: (p) => { const d = String(p.lot.date_mep || ''); return d.slice(5, 7) + '/' + d.slice(2, 4); }
        });
        $('#detail-graph', el).textContent = 'Touche une barre pour voir le lot.';
        $$('#zone-graph [data-i]', el).forEach((z) => z.addEventListener('click', () => {
          const p = points[Number(z.dataset.i)];
          $('#detail-graph', el).textContent = `${batNom(p.lot.batiment)} · ${dateFr(p.lot.date_mep)} : ${p.valeur == null ? 'pas de chiffre' : nf(p.valeur, g[2]) + ' ' + g[3]}`;
        }));
      };
      $$('[data-graph]', el).forEach((b) => b.addEventListener('click', () => {
        $$('[data-graph]', el).forEach((x) => x.classList.toggle('actif', x === b));
        dessinerGraph(b.dataset.graph);
      }));
      dessinerGraph(GRAPH_INDICATEURS[0][0]);
    }
  }

  // Graphique en barres simple : une série, barres arrondies, option « accent » sur un point, moyenne en pointillés.
  function graphSimple(points, o) {
    const dec = o.dec || 0, unite = o.unite || '';
    const L = 340, H = 180, mg = { g: 34, d: 6, h: 22, b: 26 };
    const largeur = L - mg.g - mg.d, hauteur = H - mg.h - mg.b;
    const vals = points.map((p) => p.valeur).filter((v) => v !== null && v !== undefined);
    if (!vals.length) return '<p class="doux">Pas de chiffre pour cet indicateur.</p>';
    const max = Math.max(0, ...vals), min = Math.min(0, ...vals);
    const haut = max === min ? max + 1 : max + (max - min) * 0.15;
    const y = (v) => mg.h + hauteur - ((v - min) / (haut - min)) * hauteur;
    const pas = largeur / points.length, lb = Math.max(4, Math.min(20, pas * 0.62));
    const chemin = (x0, v) => {
      const yb = y(Math.max(0, min)), yv = y(v), r = Math.min(4, Math.abs(yb - yv), lb / 2);
      return v >= 0
        ? `M${x0},${yb} V${yv + r} Q${x0},${yv} ${x0 + r},${yv} H${x0 + lb - r} Q${x0 + lb},${yv} ${x0 + lb},${yv + r} V${yb} Z`
        : `M${x0},${yb} V${yv - r} Q${x0},${yv} ${x0 + r},${yv} H${x0 + lb - r} Q${x0 + lb},${yv} ${x0 + lb},${yv - r} V${yb} Z`;
    };
    let svg = `<svg class="graph" viewBox="0 0 ${L} ${H}" role="img">`;
    [0, 0.5, 1].forEach((t) => {
      const v = min + (haut - min) * t;
      svg += `<line class="grille" x1="${mg.g}" x2="${L - mg.d}" y1="${y(v)}" y2="${y(v)}"/><text x="${mg.g - 5}" y="${y(v) + 4}" text-anchor="end">${esc(nf(v, dec > 1 ? 1 : dec))}</text>`;
    });
    const pasEtiquette = Math.ceil(points.length / 8);
    let derniereEtiquette = null, derniereX = -1e9;
    points.forEach((p, i) => {
      const x0 = mg.g + i * pas + (pas - lb) / 2;
      if (p.valeur !== null && p.valeur !== undefined) {
        svg += `<path class="barre${o.accent ? (p.accent ? ' ce-lot' : '') : ' unique'}" d="${chemin(x0, p.valeur)}"><title>${esc(nf(p.valeur, dec))} ${esc(unite)}</title></path>`;
        if (p.accent) svg += `<text class="valeur" x="${x0 + lb / 2}" y="${y(p.valeur) - 6}" text-anchor="middle">${esc(nf(p.valeur, dec))}</text>`;
      }
      if (i % pasEtiquette === 0 || (i === points.length - 1 && i % pasEtiquette >= Math.ceil(pasEtiquette / 2))) {
        const texte = o.etiquette ? o.etiquette(p) : p.cle;
        const xt = x0 + lb / 2;
        // Pas deux étiquettes identiques ou collées (ex. deux lots du même mois)
        if (texte !== derniereEtiquette && xt - derniereX >= 30) {
          svg += `<text x="${xt}" y="${H - 8}" text-anchor="middle">${esc(texte)}</text>`;
          derniereEtiquette = texte; derniereX = xt;
        }
      }
      svg += `<rect data-i="${i}" x="${mg.g + i * pas}" y="${mg.h}" width="${pas}" height="${hauteur}" fill="transparent" style="cursor:pointer"/>`;
    });
    if (o.moyenne !== null && o.moyenne !== undefined) svg += `<line class="moyenne" x1="${mg.g}" x2="${L - mg.d}" y1="${y(o.moyenne)}" y2="${y(o.moyenne)}"/>`;
    return svg + '</svg>';
  }

  // =====================================================================
  // Champs (liste + rotation) — la carte est un mode de cet onglet
  // =====================================================================
  let rechercheChamp = '';

  async function vueChamps(el, options) {
    const champs = await lire('champs');
    const annee = (champs[0] && champs[0].annee) || '';
    const parCulture = {};
    champs.forEach((c) => (c.cultures || []).forEach((k) => {
      const x = parCulture[k.code] = parCulture[k.code] || { code: k.code, culture: k.culture, ha: 0, champs: 0 };
      x.ha += Number(k.ha || 0); x.champs += 1;
    }));
    const groupes = Object.values(parCulture).sort((a, b) => b.ha - a.ha);
    const total = groupes.reduce((s, g) => s + g.ha, 0);

    el.innerHTML = `
      <div class="segmente"><button class="actif">${icone('list')}Liste</button><button data-aller="carte">${icone('map')}Carte</button></div>
      <div class="tuiles">
        <div class="tuile">${icone('grass')}<b>${nf(total, 0)} ha</b><span class="l">déclarés en ${esc(annee)}</span></div>
        <div class="tuile">${icone('crop_square')}<b>${nf(champs.filter((c) => c.ha > 0).length)}</b><span class="l">champs exploités</span></div>
      </div>
      <div class="bloc">
        <h2>${icone('donut_small')}Cultures ${esc(annee)}</h2>
        <ul class="liste">${groupes.map((g) => `
          <li><button data-code="${esc(g.code)}">
            <span class="g" style="flex:1"><b>${pastilleCulture(g.code)} ${esc(g.culture)}</b>
            <span class="doux">${pluriel(g.champs, 'champ')} · ${nf(g.ha, 2)} ha</span>
            <span class="barre-surface"><i style="width:${total ? Math.max(2, (g.ha / total) * 100) : 0}%;background:${couleurCulture(g.code)}"></i></span></span>
          </button></li>`).join('')}</ul>
      </div>
      <form class="recherche" id="form-champ" onsubmit="return false">${icone('search')}<input id="recherche-champ" type="search" placeholder="Chercher un champ" value="${esc(rechercheChamp)}" aria-label="Chercher un champ"></form>
      <div class="bloc"><h2>${icone('crop_square')}Tous les champs</h2><ul class="liste" id="liste-champs"></ul></div>
      <p class="note">Déclaration PAC Télépac (version contrôlée si elle existe, sinon déclarée). Noms des cultures à confirmer.</p>`;
    brancher(el);

    const dessiner = () => {
      const q = rechercheChamp.trim().toLowerCase();
      const liste = champs.filter((c) => !q || String(c.nom).toLowerCase().includes(q)).sort((a, b) => b.ha - a.ha);
      $('#liste-champs', el).innerHTML = liste.map((c) => `
        <li><button data-champ="${esc(c.parcelle_id)}">
          <span class="g"><b>${esc(majuscule(c.nom))}</b><span class="doux">${(c.cultures || []).map((k) => `${pastilleCulture(k.code)} ${esc(k.culture)}`).join(' · ') || 'rien de déclaré en ' + esc(annee)}</span></span>
          <span class="d">${nf(c.ha, 2)} ha</span></button></li>`).join('') || '<li class="doux" style="padding:12px 0">Aucun champ ne correspond.</li>';
      $$('[data-champ]', el).forEach((b) => b.addEventListener('click', () => ouvrirChamp(b.dataset.champ)));
    };
    $('#recherche-champ', el).addEventListener('input', (ev) => { rechercheChamp = ev.target.value; dessiner(); });
    $$('[data-code]', el).forEach((bt) => bt.addEventListener('click', () => {
      const g = parCulture[bt.dataset.code];
      ouvrir(g.culture, (e2) => vueCulture(e2, g, champs, annee));
    }));
    dessiner();
  }

  function ouvrirChamp(id) { ouvrir('Champ', (el) => vueChamp(el, id)); }

  function vueCulture(el, g, champs, annee) {
    titrePage(el, g.culture + ' ' + annee);
    const liste = champs.filter((c) => (c.cultures || []).some((k) => k.code === g.code))
      .map((c) => ({ c, ha: (c.cultures || []).filter((k) => k.code === g.code).reduce((s, k) => s + Number(k.ha || 0), 0) }))
      .sort((a, b) => b.ha - a.ha);
    el.innerHTML = `
      <div class="bloc fiche-tete"><div class="numero-grand" style="font-size:28px">${pastilleCulture(g.code)} ${esc(g.culture)}</div>
        <div class="chiffres" style="margin-top:12px">${chiffre(g.ha, 'hectares en ' + annee, 1)}${chiffre(liste.length, 'champs')}</div></div>
      <div class="bloc"><h2>${icone('crop_square')}Champs</h2><ul class="liste">${liste.map(({ c, ha }) => `
        <li><button data-champ="${esc(c.parcelle_id)}"><span class="g"><b>${esc(majuscule(c.nom))}</b></span><span class="d">${nf(ha, 2)} ha</span></button></li>`).join('')}</ul></div>
      <button class="bouton-principal" id="voir-sur-carte" style="width:100%">${icone('map')}Voir sur la carte</button>`;
    $$('[data-champ]', el).forEach((b) => b.addEventListener('click', () => ouvrirChamp(b.dataset.champ)));
    $('#voir-sur-carte', el).addEventListener('click', () => allerOnglet('carte', { annee, code: g.code }));
  }

  async function vueChamp(el, id) {
    const r = await lire('champ', { parcelle_id: id });
    const c = r && r[0];
    if (!c) { el.innerHTML = '<div class="bloc"><p>Champ introuvable.</p></div>'; return; }
    titrePage(el, majuscule(c.nom));
    const annees = (c.rotation || []).slice().reverse();
    el.innerHTML = `
      <div class="bloc fiche-tete">
        <div class="numero-grand" style="font-size:26px">${esc(majuscule(c.nom))}</div>
        <div class="badges">${(c.cultures || []).map((k) => `<span class="badge">${pastilleCulture(k.code)} ${esc(k.culture)}</span>`).join('') || '<span class="badge">rien de déclaré</span>'}</div>
        <div class="chiffres" style="margin-top:12px">${chiffre(c.ha, 'hectares en ' + c.annee, 2)}${chiffre((c.parcelles_telepac || []).length, 'parcelles PAC')}</div>
      </div>
      ${c.geometrie ? `<div class="bloc" style="padding:0;overflow:hidden"><div id="mini-carte" class="mini-carte"></div></div>` : ''}
      <div class="bloc">
        <h2>${icone('autorenew')}Rotation</h2>
        ${annees.map((a) => `<div class="ligne" style="display:block">
          <div style="display:flex;justify-content:space-between"><b>${esc(a.annee)}</b><span class="doux">${nf(a.ha, 2)} ha</span></div>
          <div class="rotation-annee">${(a.cultures || []).map((k) => `<span class="morceau" style="flex:${Math.max(0.05, Number(k.ha))};background:${couleurCulture(k.code)}" title="${esc(k.culture)} ${nf(k.ha, 2)} ha"></span>`).join('')}</div>
          <div class="doux">${(a.cultures || []).map((k) => `${esc(k.culture)} ${nf(k.ha, 2)} ha`).join(' · ')}</div></div>`).join('') || '<p class="doux">Pas d\'historique.</p>'}
      </div>
      ${(c.parcelles_telepac || []).length ? `<div class="bloc"><h2>${icone('description')}Parcelles PAC ${esc(c.annee)}</h2>
        ${c.parcelles_telepac.map((p) => ligne(`Îlot ${esc(p.ilot)} · parcelle ${esc(p.numero)}<br><span class="doux">${esc(p.culture)}${p.partagee ? ` · parcelle PAC de ${nf(p.ha_parcelle, 2)} ha partagée avec un autre champ` : ''}</span>`, nf(p.ha, 2) + ' ha')).join('')}
        ${c.parcelles_telepac.some((p) => p.partagee) ? '<p class="note">Pour une parcelle partagée, la surface indiquée est la partie dans ce champ (calcul sur les contours).</p>' : ''}</div>` : ''}
      <div id="docs-champ"></div>
      <button class="bouton-principal" id="info-champ" style="width:100%;margin-bottom:10px">${icone('add_circle')}Noter une info sur ce champ</button>
      <button class="bouton-secondaire large" id="champ-carte">${icone('map')}Voir sur la grande carte</button>`;
    $('#info-champ', el).addEventListener('click', () => noter({ atelier: 'cultures', parcelle: majuscule(c.nom), libelle: majuscule(c.nom) }));
    blocDocuments($('#docs-champ', el), { type: 'champ', id: String(id), libelle: majuscule(c.nom), vide: 'Analyse de terre, plan d\'épandage, photo : ajoute-les ici.' });
    $('#champ-carte', el).addEventListener('click', () => allerOnglet('carte', { cible: { nom: c.nom, geometrie: c.geometrie || null } }));
    if (c.geometrie) {
      setTimeout(() => {
        const m = L.map('mini-carte', { zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, touchZoom: false, boxZoom: false, keyboard: false });
        coucheIGN('ORTHOIMAGERY.ORTHOPHOTOS', 'image/jpeg').addTo(m);
        const forme = L.geoJSON(c.geometrie, { style: { color: '#ffffff', weight: 2, fillColor: couleurCulture((c.cultures[0] || {}).code), fillOpacity: 0.35 } }).addTo(m);
        m.fitBounds(forme.getBounds(), { padding: [16, 16] });
      }, 30);
    }
  }

  // =====================================================================
  // Carte
  // =====================================================================
  let carte = null;
  let calquesCouches = {};
  let marqueurPosition = null;
  const couchesVisibles = { cultures_annee: true, en_terre: true, batiments: true, terres_gaec: false, champs_pac: false, proprietes_famille: false, sapinieres: true };
  const ORDRE_COUCHES = ['cultures_annee', 'en_terre', 'batiments', 'terres_gaec', 'champs_pac', 'proprietes_famille', 'sapinieres'];
  // Couches dont chaque forme porte un code culture (couleur + mise en avant en jaune)
  const COUCHES_CULTURES = ['cultures_annee', 'en_terre'];
  // « En terre maintenant » : même couleurs que les cultures, bord blanc en pointillés pour la distinguer de la récolte déclarée
  const styleEnTerre = (p) => Object.assign(styleCulture(p), { color: '#ffffff', weight: cultureEnAvant && p.code_culture === cultureEnAvant ? 3 : 2, dashArray: '6 5', opacity: 1 });

  function coucheIGN(couche, format) {
    return L.tileLayer('https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=' + couche +
      '&STYLE=normal&TILEMATRIXSET=PM&FORMAT=' + format + '&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}', { maxZoom: 20, maxNativeZoom: 19, attribution: '© IGN' });
  }

  function initCarte() {
    carte = L.map('carte', { zoomControl: false, attributionControl: true, zoomSnap: 0.25 });
    L.control.zoom({ position: 'topright' }).addTo(carte);
    const photo = coucheIGN('ORTHOIMAGERY.ORTHOPHOTOS', 'image/jpeg');
    const plan = coucheIGN('GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2', 'image/png');
    photo.addTo(carte);
    L.control.layers({ 'Photo aérienne': photo, 'Plan': plan }, null, { position: 'topright' }).addTo(carte);
    const Localiser = L.Control.extend({
      options: { position: 'topright' },
      onAdd: function () {
        const b = L.DomUtil.create('button', 'bouton-carte');
        b.type = 'button'; b.title = 'Où suis-je ?'; b.innerHTML = icone('my_location');
        L.DomEvent.on(b, 'click', (ev) => { L.DomEvent.stop(ev); carte.locate({ setView: true, maxZoom: 17, enableHighAccuracy: true }); });
        return b;
      }
    });
    carte.addControl(new Localiser());
    carte.on('locationfound', (e) => {
      if (marqueurPosition) carte.removeLayer(marqueurPosition);
      marqueurPosition = L.circleMarker(e.latlng, { radius: 9, color: '#ffffff', weight: 3, fillColor: '#2a78d6', fillOpacity: 1 }).addTo(carte).bindPopup('Tu es ici');
    });
    carte.on('locationerror', () => alert("Impossible de trouver ta position. Vérifie que la localisation est autorisée pour l'appli."));
    carte.setView([48.40, -3.76], 13);
  }

  function popupTexte(p) {
    if (p.couche === 'en_terre') {
      return [`<b>${esc(majuscule(p.nom || ''))}</b>`, 'En terre maintenant : <b>' + esc(p.culture || p.code_culture || '') + '</b>' + (p.statut === 'a_confirmer' ? ' <i>(à confirmer)</i>' : ''),
        '<span style="opacity:.75">Semé à l\'automne, dit par la famille ; pas encore déclaré à la PAC</span>'].join('<br>');
    }
    const lignes = [`<b>${esc(majuscule(p.nom || p.couche_libelle))}</b>`, esc(p.couche_libelle)];
    if (p.culture) lignes.push('Culture ' + esc(p.annee) + ' : <b>' + esc(p.culture) + '</b>');
    if (p.surface_m2) lignes.push('Surface : ' + esc(surfaceTexte(p.surface_m2)));
    return lignes.join('<br>');
  }

  // Culture mise en avant sur la carte (en jaune vif, les autres en pâle)
  let cultureEnAvant = null;
  let calqueCible = null; // contour jaune de l'endroit qu'on veut montrer (un champ, une sapinière…)
  const JAUNE_EN_AVANT = '#ffd60a';
  function styleCulture(p) {
    if (!cultureEnAvant) return { color: '#ffffff', weight: 1.2, fillColor: couleurCulture(p.code_culture), fillOpacity: 0.6, opacity: 0.9 };
    return p.code_culture === cultureEnAvant
      ? { color: '#ffffff', weight: 2.5, fillColor: JAUNE_EN_AVANT, fillOpacity: 0.85, opacity: 1 }
      : { color: '#ffffff', weight: 0.5, fillColor: couleurCulture(p.code_culture), fillOpacity: 0.1, opacity: 0.35 };
  }

  async function vueCarte(opts) {
    const fc = await lire('carte', opts.annee ? { annee: opts.annee } : {});
    if (!carte) initCarte();
    setTimeout(() => carte.invalidateSize(), 50);
    Object.values(calquesCouches).forEach((c) => carte.removeLayer(c.calque));
    calquesCouches = {};
    const parCouche = {};
    fc.features.forEach((f) => { (parCouche[f.properties.couche] = parCouche[f.properties.couche] || []).push(f); });
    if (opts.code !== undefined) cultureEnAvant = opts.code || null;
    if (cultureEnAvant) couchesVisibles.cultures_annee = true;

    ORDRE_COUCHES.concat(Object.keys(parCouche).filter((k) => !ORDRE_COUCHES.includes(k))).forEach((nom) => {
      const feats = parCouche[nom];
      if (!feats || !feats.length) return;
      const style0 = feats[0].properties.style || {};
      const calque = L.geoJSON({ type: 'FeatureCollection', features: feats }, {
        style: (f) => {
          const p = f.properties; const st = p.style || {};
          if (nom === 'cultures_annee') return styleCulture(p);
          if (nom === 'en_terre') return styleEnTerre(p);
          return { color: st.couleur || '#ff9f0a', weight: 2, fillColor: st.couleur || '#ff9f0a', fillOpacity: st.remplissage ?? 0.2 };
        },
        onEachFeature: (f, couche) => couche.bindPopup(popupTexte(f.properties))
      });
      calquesCouches[nom] = { calque, libelle: feats[0].properties.couche_libelle || nom, couleur: nom === 'cultures_annee' ? '#7cc36b' : nom === 'en_terre' ? '#e0a030' : (style0.couleur || '#ff9f0a'), nb: feats.length };
      if (couchesVisibles[nom]) calque.addTo(carte);
    });

    // Cultures de l'année, de la plus grande à la plus petite surface (pour les boutons « mettre en avant »)
    const surfaceCode = {}, libelleCode = {};
    (parCouche.cultures_annee || []).concat(parCouche.en_terre || []).forEach((f) => {
      const p = f.properties;
      libelleCode[p.code_culture] = p.culture || p.code_culture;
      surfaceCode[p.code_culture] = (surfaceCode[p.code_culture] || 0) + Number(p.surface_m2 || 0);
    });
    const codes = Object.keys(surfaceCode).sort((a, b) => surfaceCode[b] - surfaceCode[a]);
    if (cultureEnAvant && !codes.includes(cultureEnAvant)) cultureEnAvant = null;
    const panneau = $('#carte-couches');
    const etaitReplie = panneau.classList.contains('replie');
    const anneeMax = new Date().getFullYear();
    panneau.innerHTML = `
      ${codes.length ? `<div class="puces puces-carte" role="group" aria-label="Mettre une culture en avant">
        <button class="puce${cultureEnAvant ? '' : ' actif'}" data-en-avant="">Toutes</button>
        ${codes.map((k) => `<button class="puce${cultureEnAvant === k ? ' actif' : ''}" data-en-avant="${esc(k)}">${pastilleCulture(k)}${esc(libelleCode[k])}</button>`).join('')}
      </div>` : ''}
      <div class="entete"><button id="replier-couches">${icone('layers')}Couches ${etaitReplie ? '▴' : '▾'}</button>
        <span style="display:flex;gap:8px;align-items:center"><select id="annee-carte" aria-label="Année">${[0, 1, 2, 3, 4].map((i) => anneeMax - i).map((a) => `<option${a === fc.annee ? ' selected' : ''}>${a}</option>`).join('')}</select>
        <button class="bouton-secondaire" id="vers-liste" style="padding:8px 10px">${icone('list')}Champs</button></span></div>
      <div class="contenu-couches">
        ${Object.entries(calquesCouches).map(([nom, c]) => `
          <label><input type="checkbox" data-couche="${esc(nom)}"${couchesVisibles[nom] ? ' checked' : ''}>
          <span class="pastille" style="background:${c.couleur}"></span>${esc(nom === 'cultures_annee' ? 'Cultures ' + fc.annee + ' (récolte, PAC)' : nom === 'en_terre' ? 'En terre maintenant (dit par la famille)' : c.libelle)} <span class="doux">(${c.nb})</span></label>`).join('')}
        <p class="doux" style="margin:6px 0">${icone('water_drop', 'petite')} Réseau d'eau : pas encore enregistré dans la base (dessin en cours avec GPT).</p>
        ${codes.length ? `<div class="doux legende-cultures">${codes.map((k) => `<span>${pastilleCulture(k)}${esc(libelleCode[k])}</span>`).join('')}</div>` : ''}
      </div>`;
    const montrerPuceActive = () => { const p = $('.puces-carte .puce.actif', panneau); const rangee = $('.puces-carte', panneau); if (p && rangee) rangee.scrollLeft = p.offsetLeft - (rangee.clientWidth - p.offsetWidth) / 2; };
    montrerPuceActive();
    $$('[data-en-avant]', panneau).forEach((b) => b.addEventListener('click', () => {
      cultureEnAvant = b.dataset.enAvant || null;
      $$('[data-en-avant]', panneau).forEach((x) => x.classList.toggle('actif', (x.dataset.enAvant || null) === cultureEnAvant));
      montrerPuceActive();
      let lim = null;
      COUCHES_CULTURES.forEach((nomC) => {
        const c = calquesCouches[nomC];
        if (!c) return;
        if (cultureEnAvant && !couchesVisibles[nomC]) {
          couchesVisibles[nomC] = true; c.calque.addTo(carte);
          const cb = $(`[data-couche="${nomC}"]`, panneau); if (cb) cb.checked = true;
        }
        c.calque.setStyle((f) => (nomC === 'en_terre' ? styleEnTerre(f.properties) : styleCulture(f.properties)));
        c.calque.eachLayer((l) => { if (!cultureEnAvant || l.feature.properties.code_culture === cultureEnAvant) lim = lim ? lim.extend(l.getBounds()) : L.latLngBounds(l.getBounds().getSouthWest(), l.getBounds().getNorthEast()); });
      });
      if (lim && lim.isValid()) carte.fitBounds(lim, { paddingTopLeft: [20, 20], paddingBottomRight: [20, panneau.offsetHeight + 20], maxZoom: 16 });
    }));
    $('#replier-couches').onclick = () => { panneau.classList.toggle('replie'); $('#replier-couches').innerHTML = icone('layers') + 'Couches ' + (panneau.classList.contains('replie') ? '▴' : '▾'); };
    $('#annee-carte').onchange = (ev) => afficher({ titre: 'Carte de la ferme', carte: true, rendu: () => vueCarte({ annee: Number(ev.target.value), garderVue: true }) });
    $('#vers-liste').onclick = () => allerOnglet('champs');
    $$('[data-couche]', panneau).forEach((cb) => cb.addEventListener('change', () => {
      const nom = cb.dataset.couche;
      couchesVisibles[nom] = cb.checked;
      if (cb.checked) calquesCouches[nom].calque.addTo(carte); else carte.removeLayer(calquesCouches[nom].calque);
    }));

    // Un endroit précis à montrer (fiche d'un champ, recherche « 80.4 », « D 116 »…) : contour jaune épais et carte centrée dessus
    if (calqueCible) { carte.removeLayer(calqueCible); calqueCible = null; }
    if (opts.cible) {
      const ci = opts.cible;
      let geo = ci.geometrie || null;
      const f = !geo && ci.nom ? fc.features.find((x) => x.properties.nom === ci.nom && (!ci.couche || x.properties.couche === ci.couche)) : null;
      if (f) {
        geo = f.geometry;
        const nomC = f.properties.couche;
        if (calquesCouches[nomC] && !couchesVisibles[nomC]) {
          couchesVisibles[nomC] = true; calquesCouches[nomC].calque.addTo(carte);
          const cb = $(`[data-couche="${nomC}"]`, panneau); if (cb) cb.checked = true;
        }
      }
      if (geo) {
        calqueCible = L.geoJSON(geo, { style: { color: '#ffd60a', weight: 5, fill: true, fillColor: '#ffd60a', fillOpacity: 0.12 }, interactive: false }).addTo(carte);
        const b = calqueCible.getBounds();
        if (b.isValid()) { carte.fitBounds(b, { paddingTopLeft: [30, 30], paddingBottomRight: [30, panneau.offsetHeight + 30], maxZoom: 17 }); return; }
      }
    }

    let limites = null;
    const etendre = (b) => { if (b && b.isValid()) limites = limites ? limites.extend(b) : L.latLngBounds(b.getSouthWest(), b.getNorthEast()); };
    if (cultureEnAvant) COUCHES_CULTURES.forEach((nomC) => {
      if (calquesCouches[nomC]) calquesCouches[nomC].calque.eachLayer((c) => { if (c.feature.properties.code_culture === cultureEnAvant) etendre(c.getBounds()); });
    });
    if (!limites) Object.entries(calquesCouches).forEach(([nom, c]) => { if (couchesVisibles[nom]) etendre(c.calque.getBounds()); });
    if (limites && !opts.garderVue) carte.fitBounds(limites, { paddingTopLeft: [20, 20], paddingBottomRight: [20, panneau.offsetHeight + 20] });
  }

  // =====================================================================
  // Discuter (IA)
  // =====================================================================
  const conversation = [];
  let enAttente = false;
  const SUGGESTIONS = [
    ['egg_alt', 'Mon dernier lot de poulets était comment par rapport aux précédents ?'],
    ['pets', 'Combien de génisses de plus de 2 ans n\'ont pas encore vêlé ?'],
    ['grass', 'Où est le triticale cette année ?'],
    ['real_estate_agent', 'Qu\'est-ce qu\'on a comme papiers pour la SCI ?'],
    ['edit_note', 'La 1142 a vêlé d\'une femelle ce matin']
  ];

  // Sans IA (pas encore branchée, plafond, réseau) : proposer le bon écran d'après les mots de la question.
  const MOTS_CULTURES = [[/triticale/i, 'TTH', 'le triticale'], [/colza/i, 'CZH', 'le colza'], [/m[ée]lange|l[ée]gumineuse/i, 'MLG', 'le mélange légumineuses-graminées'],
    [/prairie temporaire/i, 'PTR', 'les prairies temporaires'], [/prairie/i, 'PPH', 'les prairies de 6 ans ou plus'], [/ma[iï]s/i, 'MIS', 'le maïs'],
    [/avoine/i, 'AVH', "l'avoine"], [/sarrasin|bl[ée] noir/i, 'SRS', 'le sarrasin'], [/seigle/i, 'SGH', 'le seigle']];
  function liensRapides(q) {
    const l = [];
    const m = String(q).match(/\b(\d{3,4})\b/);
    const num = m && !(Number(m[1]) >= 1990 && Number(m[1]) <= 2100) ? m[1] : null;
    if (/v[êe]l[ée]|soign|trait[ée]|\bmorte?\b|crev|vendu|achet|loyer|pay[ée]|locataire|r[ée]par|facture/i.test(q)) {
      const atelier = /loyer|locataire|maison|\bsci\b/i.test(q) ? 'sci' : /poulet|poulailler|volaille|\blot\b/i.test(q) ? 'volailles' : /champ|parcelle/i.test(q) ? 'cultures' : num ? 'bovins' : 'autre';
      l.push({ t: 'noter', v: { atelier, numero_animal: atelier === 'bovins' ? num : undefined, texte: q }, libelle: "Noter cette info sans l'IA", ic: 'edit_note' });
    }
    if (num) l.push({ t: 'vache', v: num, libelle: 'Voir la fiche de la ' + num, ic: 'pets' });
    const cult = MOTS_CULTURES.find(([re]) => re.test(q));
    if (cult) l.push({ t: 'carte', v: cult[1], libelle: 'Voir ' + cult[2] + ' sur la carte', ic: 'map' });
    if (/\blots?\b|poulet|volaille|poulailler|princior|dinde|\bic\b|marge/i.test(q)) l.push({ t: 'onglet', v: 'volailles', libelle: 'Voir les lots de volailles', ic: 'egg_alt' });
    if (!num && /vache|veau|g[ée]nisse|taureau|troupeau|v[êe]l/i.test(q)) l.push({ t: 'onglet', v: 'vaches', libelle: 'Voir le troupeau', ic: 'pets' });
    if (!cult && /champ|parcelle|hectare|\bha\b|culture/i.test(q)) l.push({ t: 'onglet', v: 'champs', libelle: 'Voir les champs', ic: 'grass' });
    if (/\bsci\b|maison|loyer|locataire/i.test(q)) l.push({ t: 'page', v: 'sci', libelle: 'Voir la SCI', ic: 'real_estate_agent' });
    if (/papier|facture|document|photo/i.test(q)) l.push({ t: 'page', v: 'documents', libelle: 'Voir les documents', ic: 'folder_open' });
    if (/b[âa]timent|hangar|porcherie|[ée]table/i.test(q)) l.push({ t: 'page', v: 'batiments', libelle: 'Voir les bâtiments', ic: 'home_work' });
    if (!l.length && /(^|\s)o[ùu](\s|$|\?)|carte/i.test(q)) l.push({ t: 'onglet', v: 'carte', libelle: 'Ouvrir la carte', ic: 'map' });
    return l.slice(0, 3);
  }

  function texteRiche(t) {
    const lignes = esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').split('\n');
    let html = '', liste = false;
    lignes.forEach((l) => {
      const m = l.match(/^\s*[-•*]\s+(.*)$/);
      if (m) { if (!liste) { html += '<ul>'; liste = true; } html += '<li>' + m[1] + '</li>'; return; }
      if (liste) { html += '</ul>'; liste = false; }
      html += l.trim() ? l + '<br>' : '<br>';
    });
    if (liste) html += '</ul>';
    return html.replace(/(<br>)+$/, '');
  }

  function ficheAjoutHtml(p, i, j) {
    const etat = p._etat || 'a_confirmer';
    const details = [];
    if (p.numero_animal) details.push('Bête n° ' + esc(p.numero_animal));
    if (p.lot) details.push('Lot ' + esc(p.lot));
    if (p.parcelle) details.push('Champ : ' + esc(p.parcelle));
    details.push(p.date_evenement ? 'Date : ' + esc(dateFr(p.date_evenement)) + (p.precision_date && p.precision_date !== 'jour' ? ' (' + esc(p.precision_date) + ')' : '') : 'Date : inconnue');
    if (p.donnees && typeof p.donnees === 'object') {
      Object.entries(p.donnees).forEach(([k, v]) => { if (v !== null && v !== '' && typeof v !== 'object') details.push(esc(k.replace(/_/g, ' ')) + ' : ' + esc(v)); });
    }
    return `<div class="fiche-ajout" data-i="${i}" data-j="${j}">
      <div class="titre">${icone('edit_note')} ${esc(nomFait(p.type))} · ${esc(p.atelier)}</div>
      <div>${esc(p.resume)}</div>
      <div class="doux">${details.join(' · ')}</div>
      ${etat === 'a_confirmer' ? '<div class="boutons"><button class="ok" data-action="enregistrer">Enregistrer</button><button class="non" data-action="annuler">Annuler</button></div>'
        : etat === 'enregistre' ? `<p class="doux"><b>${icone('check_circle', 'plein petite')} Enregistré</b> — visible dans l'appli, l'atelier l'intégrera dans son registre.</p>`
        : etat === 'envoi' ? '<p class="doux">Enregistrement…</p>'
        : etat === 'erreur' ? `<p class="erreur">${esc(p._erreur || 'Pas enregistré.')}</p><div class="boutons"><button class="ok" data-action="enregistrer">Réessayer</button></div>`
        : '<p class="doux">Annulé, rien n\'a été enregistré.</p>'}
    </div>`;
  }

  function dessinerDiscussion(el) {
    if (!conversation.length) {
      el.innerHTML = `<div class="bloc"><h2>${icone('forum')}Discuter</h2>
        <p>Pose une question sur la ferme, ou donne une info à garder. Tu peux écrire ou appuyer sur le micro du clavier pour parler.</p>
        <div class="suggestions">${SUGGESTIONS.map(([ic, s]) => `<button data-suggestion="${esc(s)}">${icone(ic)}${esc(s)}</button>`).join('')}</div>
        <p class="note">Les réponses viennent des données de la ferme. Une info n'est gardée que si tu appuies sur « Enregistrer ».</p>
        <button class="bouton-secondaire large" data-noter="">${icone('edit_note')}Noter une info sans l'IA</button></div>`;
      $$('[data-suggestion]', el).forEach((b) => b.addEventListener('click', () => { $('#saisie').value = b.dataset.suggestion; $('#saisie').focus(); }));
      brancher(el);
      return;
    }
    el.innerHTML = conversation.map((m, i) => {
      if (m.role === 'user') return `<div class="bulle moi">${esc(m.content)}</div>`;
      return `<div class="bulle ia">${texteRiche(m.content)}${m.cout != null ? `<span class="cout">≈ ${nf(m.cout, 3)} $</span>` : ''}</div>
        ${(m.liens || []).length ? `<div class="liens-rapides"><p class="doux">En attendant, c'est peut-être ici :</p>${m.liens.map((x, k) => `<button class="bouton-secondaire" data-lien="${i}:${k}">${icone(x.ic)}${esc(x.libelle)}</button>`).join('')}</div>` : ''}
        ${(m.propositions || []).map((p, j) => ficheAjoutHtml(p, i, j)).join('')}
        ${m.carte ? `<button class="bouton-secondaire" data-carte="${i}" style="margin:2px 0 10px">${icone('map')}Voir sur la carte</button>` : ''}`;
    }).join('') + (enAttente ? '<div class="bulle ia attente"><span class="points"><i></i><i></i><i></i></span> Je cherche dans les données de la ferme…</div>' : '');

    $$('.fiche-ajout button', el).forEach((b) => b.addEventListener('click', async () => {
      const fiche = b.closest('.fiche-ajout');
      const p = conversation[Number(fiche.dataset.i)].propositions[Number(fiche.dataset.j)];
      if (b.dataset.action === 'annuler') { p._etat = 'annule'; dessinerDiscussion(el); return; }
      p._etat = 'envoi'; dessinerDiscussion(el);
      const { error } = await sb.rpc('famille_ajouter', {
        p_donnees: {
          atelier: p.atelier, type: p.type, numero_animal: p.numero_animal || null, lot: p.lot || null, parcelle: p.parcelle || null,
          date_evenement: p.date_evenement || null, precision_date: p.precision_date || null, resume: p.resume, donnees: p.donnees || {},
          texte_origine: p.texte_origine || null, via: 'appli-discuter'
        }
      });
      if (error) { p._etat = 'erreur'; p._erreur = messageErreur(error); } else { p._etat = 'enregistre'; viderCache(); }
      dessinerDiscussion(el);
    }));
    $$('[data-lien]', el).forEach((b) => b.addEventListener('click', () => {
      const [i, k] = b.dataset.lien.split(':').map(Number);
      const x = (conversation[i].liens || [])[k];
      if (!x) return;
      if (x.t === 'noter') noter(x.v);
      else if (x.t === 'vache') ouvrirVache(x.v);
      else if (x.t === 'carte') allerOnglet('carte', { code: x.v });
      else if (x.t === 'page' && PAGES[x.v]) ouvrir(PAGES[x.v][0], PAGES[x.v][1]);
      else allerOnglet(x.v);
    }));
    $$('[data-carte]', el).forEach((b) => b.addEventListener('click', () => {
      const c = conversation[Number(b.dataset.carte)].carte || {};
      allerOnglet('carte', { annee: c.annee || undefined, code: c.code || undefined });
    }));
    window.scrollTo(0, document.body.scrollHeight);
  }

  async function envoyerQuestion(el) {
    const champ = $('#saisie');
    const q = champ.value.trim();
    if (!q || enAttente) return;
    champ.value = ''; champ.style.height = '';
    conversation.push({ role: 'user', content: q });
    enAttente = true;
    $('#bouton-envoyer').disabled = true;
    dessinerDiscussion(el);
    const historique = conversation.filter((m) => !m.erreur).map((m) => ({ role: m.role, content: m.content }));
    try {
      const { data, error } = await sb.functions.invoke('famille-discuter', { body: { messages: historique } });
      if (error) {
        let texte = messageErreur(error);
        try { const corps = await error.context.json(); if (corps && corps.texte) texte = corps.texte; else if (corps && corps.erreur === 'acces_refuse') texte = messageErreur({ message: 'acces_refuse' }); } catch (e2) { /* garde le message */ }
        conversation.push({ role: 'assistant', content: texte, erreur: true, liens: liensRapides(q) });
      } else {
        conversation.push({ role: 'assistant', content: data.texte || '…', propositions: data.propositions || [], carte: data.carte || null, cout: data.cout_usd });
      }
    } catch (e) {
      conversation.push({ role: 'assistant', content: messageErreur(e), erreur: true, liens: liensRapides(q) });
    } finally {
      enAttente = false;
      $('#bouton-envoyer').disabled = false;
      if (vueCourante && vueCourante.discuter) dessinerDiscussion(contenu);
    }
  }

  async function vueDiscuter(el, options) {
    dessinerDiscussion(el);
    if (options.prefill) { const champ = $('#saisie'); champ.value = options.prefill; setTimeout(() => champ.focus(), 50); }
  }
  $('#barre-saisie').addEventListener('submit', (ev) => { ev.preventDefault(); envoyerQuestion(contenu); });
  $('#saisie').addEventListener('input', (ev) => { const t = ev.target; t.style.height = ''; t.style.height = Math.min(t.scrollHeight, 140) + 'px'; });
  $('#saisie').addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.shiftKey && window.matchMedia('(pointer: fine)').matches) { ev.preventDefault(); envoyerQuestion(contenu); }
  });

  // =====================================================================
  // Plus : bâtiments, tâches, journal, ajouts, administration
  // =====================================================================
  const NOMS_ATELIERS = { volailles: 'Volailles', bovins: 'Troupeau', cultures: 'Champs', porcs: 'Porcs', batiments: 'Bâtiments', cerveau: 'Coordination' };
  const ICONES_ATELIERS = { volailles: 'egg_alt', bovins: 'pets', cultures: 'grass', porcs: 'savings', batiments: 'home_work', cerveau: 'hub' };

  // Appels de gestion (statut, membres, valider, bloquer) — jamais mis en cache
  async function gerer(action, params) {
    const { data, error } = await sb.rpc('famille_gerer', { p_action: action, p_params: params || {} });
    if (error) throw error;
    return data;
  }

  // Taille du texte (réglage propre à chaque téléphone)
  const CLE_TEXTE = 'ferme-denis-texte';
  function appliquerTailleTexte() {
    let grand = false;
    try { grand = localStorage.getItem(CLE_TEXTE) === 'grand'; } catch (e) { /* stockage indisponible */ }
    document.body.classList.toggle('grand-texte', grand);
    return grand;
  }

  async function vuePlus(el) {
    const moi = await lire('moi');
    const grand = appliquerTailleTexte();
    el.innerHTML = `
      <div class="menu-plus">
        ${[['sci', 'real_estate_agent', 'SCI', 'Maisons de location, baux, loyers, papiers'],
           ['documents', 'folder_open', 'Tous les documents', 'Photos, factures, papiers ajoutés par la famille'],
           ['batiments', 'home_work', 'Bâtiments', 'Poulaillers, porcheries, étable, maisons'],
           ['a_faire', 'checklist', 'À faire', 'La liste de la famille : quoi, pour qui, pour quand'],
           ['taches', 'smart_toy', 'Travail des assistants', 'Ce que Claude et GPT ont encore à faire, par atelier'],
           ['journal', 'menu_book', 'Journal des ateliers', 'Ce qui a été fait et vérifié'],
           ['ajouts', 'edit_note', 'Infos ajoutées par la famille', 'Vêlages, soins, loyers, remarques…'],
           ['sources', 'hub', 'Nos sources', 'D\'où viennent les chiffres : sites, papiers, ce qui manque']]
          .map(([id, ic, t, s]) => `<button class="alerte-ligne info" data-ouvrir="${id}">${icone(ic)}<span class="txt"><b>${esc(t)}</b><span>${esc(s)}</span></span>${icone('chevron_right')}</button>`).join('')}
      </div>
      <div id="bloc-famille"></div>
      <div id="bloc-admin"></div>
      <div class="bloc">
        <h2>${icone('person')}Mon compte</h2>
        ${ligne('Connecté', esc(moi.nom) + (moi.role === 'admin' ? ' <span class="etiquette">administrateur</span>' : ''))}
        <div class="ligne"><div class="g"><b>Texte plus grand</b><br><span class="doux">Plus facile à lire sur ce téléphone</span></div>
          <div class="d"><button class="interrupteur${grand ? ' actif' : ''}" id="plus-texte" role="switch" aria-checked="${grand}" aria-label="Texte plus grand"><i></i></button></div></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
          <button class="bouton-secondaire" id="plus-actualiser">${icone('refresh')}Actualiser les données</button>
          <button class="bouton-secondaire" id="plus-sortir">${icone('logout')}Se déconnecter</button>
        </div>
      </div>
      <div class="bloc">
        <h2>${icone('info')}À propos</h2>
        <p class="doux">Appli de la famille Denis (GAEC DENIS, Berrien). Les données de la ferme se lisent ici ; on ne les change pas depuis l'appli, sauf les infos et documents que vous ajoutez vous-mêmes. Sources : inventaire EDE, déclarations PAC (Télépac), bilans de lots (Fermatel, Maestro), carte IGN, météo Open-Meteo.</p>
        <p class="note">Version ${esc(C.version)}</p>
      </div>`;
    brancher(el);
    $('#plus-texte', el).addEventListener('click', (ev) => {
      const b = ev.currentTarget;
      const nouveau = !b.classList.contains('actif');
      try { localStorage.setItem(CLE_TEXTE, nouveau ? 'grand' : 'normal'); } catch (e) { /* stockage indisponible */ }
      document.body.classList.toggle('grand-texte', nouveau);
      b.classList.toggle('actif', nouveau);
      b.setAttribute('aria-checked', String(nouveau));
    });
    $('#plus-actualiser', el).addEventListener('click', async () => {
      const bt = $('#plus-actualiser', el);
      viderCache(); meteoCache = null;
      bt.disabled = true; bt.innerHTML = icone('hourglass_top') + 'Rechargement…';
      const r = await prechargement();
      const echec = r.find((x) => x.status === 'rejected');
      bt.disabled = false;
      bt.innerHTML = echec ? icone('error') + esc(messageErreur(echec.reason)) : icone('check') + 'Données rechargées';
    });
    $('#plus-sortir', el).addEventListener('click', async () => {
      await envoyerEnAttente();
      const restent = lireFile().length;
      if (!confirm(restent ? `${pluriel(restent, 'info notée', 'infos notées')} sans réseau ${restent > 1 ? 'ne sont' : 'n\'est'} pas encore ${restent > 1 ? 'parties' : 'partie'} et ${restent > 1 ? 'seront perdues' : 'sera perdue'}. Se déconnecter quand même ?` : 'Se déconnecter de l\'appli sur ce téléphone ?')) return;
      await sb.auth.signOut();
      montrerConnexion();
    });
    if (moi.role === 'admin') {
      blocFamille($('#bloc-famille', el));
      try {
        const b = await lire('budget_ia');
        $('#bloc-admin', el).innerHTML = `<div class="bloc"><h2>${icone('smart_toy')}Dépenses de l'IA</h2>
          ${ligne('Questions ce mois', nf(b.questions_mois))}
          ${ligne('Dépense estimée ce mois', nf(b.depense_usd_mois, 2) + ' $')}
          ${ligne('Plafond du mois', nf(b.plafond_usd_mois, 0) + ' $')}
          <div class="barre-surface" style="height:10px"><i style="width:${b.plafond_usd_mois ? Math.min(100, (b.depense_usd_mois / b.plafond_usd_mois) * 100) : 0}%;background:var(--vert-vif)"></i></div>
          <p class="note">Modèle : ${esc(b.modele === 'claude-opus-5-5' ? 'Claude Opus 5.5' : (b.modele || ''))}. Chaque question met 1 $ de côté avant de partir et s'arrête avant de le dépasser ; quand le plafond est atteint, l'IA ne prend plus de question jusqu'au mois suivant. La dépense est comptée par le serveur, pas par le téléphone.</p></div>`;
      } catch (e) { /* bloc facultatif */ }
    }
  }

  // La famille dans l'appli (administrateur seulement) : qui est entré, qui attend, qui n'est pas encore venu.
  async function blocFamille(conteneur) {
    let membres;
    try { membres = await gerer('membres'); } catch (e) { conteneur.innerHTML = ''; return; }
    const etat = (m) => m.etat === 'actif'
      ? (m.derniere_connexion ? 'dernière visite le ' + dateFr(String(m.derniere_connexion).slice(0, 10)) : 'pas encore venu')
      : m.etat === 'en_attente' ? 'attend ta validation'
      : m.etat === 'nouveau_mdp' ? `peut choisir un nouveau mot de passe pendant 3 jours · ${m.code_actif ? 'code d\'accès donné' : 'donne-lui d\'abord un code d\'accès'}`
      : m.etat === 'invite' ? `invité, pas encore venu (jusqu'au ${dateFr(String(m.valable_jusqu_au).slice(0, 10))}) · ${m.code_actif ? 'code d\'accès donné' : 'pas encore de code d\'accès'}`
      : 'invitation expirée : demande-la à Claude';
    conteneur.innerHTML = `<div class="bloc"><h2>${icone('group')}La famille dans l'appli</h2>
      ${membres.map((m) => `<div class="membre">
        <span class="avatar${m.etat === 'actif' ? '' : ' gris'}">${esc(String(m.nom || '?').charAt(0))}</span>
        <span class="txt"><b>${esc(m.nom)}${m.role === 'admin' ? ' <span class="etiquette">administrateur</span>' : ''}${m.moi ? ' <span class="doux">(toi)</span>' : ''}</b>
          <span class="${m.etat === 'en_attente' ? 'attention' : 'doux'}">${esc(etat(m))}</span><span class="faible">${esc(m.email || '')}</span></span>
        ${m.etat === 'invite' || m.etat === 'nouveau_mdp' ? `<button class="bouton-principal petit-bouton" data-code="${esc(m.email)}" data-nom="${esc(m.nom)}">${m.code_actif ? 'Nouveau code' : 'Donner un code'}</button>`
          : m.etat === 'en_attente' ? `<button class="bouton-principal petit-bouton" data-valider="${esc(m.membre_id)}" data-nom="${esc(m.nom)}">Valider</button>`
          : m.etat === 'actif' && !m.moi ? `<span class="boutons-membre"><button class="bouton-discret" data-mdp="${esc(m.membre_id)}" data-nom="${esc(m.nom)}">Mot de passe oublié</button>
              <button class="bouton-discret" data-bloquer="${esc(m.membre_id)}" data-nom="${esc(m.nom)}">Bloquer</button></span>` : ''}
      </div>`).join('')}
      <p class="note">Pour entrer la première fois : touche « Donner un code » et donne-lui les 6 chiffres de vive voix. Il ouvre l'appli, touche « Première fois ? », tape son e-mail, le code et choisit son mot de passe. Tu valides ensuite ici. Mot de passe oublié : bouton à côté de son nom, puis un nouveau code.</p></div>`;
    $$('[data-code]', conteneur).forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        const r = await gerer('code', { email: b.dataset.code });
        const c = String(r.code || '');
        feuille(`<h2 class="feuille-titre">Code d'accès pour ${esc(b.dataset.nom)}</h2>
          <div class="code-acces">${esc(c.slice(0, 3))} ${esc(c.slice(3))}</div>
          <p>Donne-lui ces 6 chiffres <b>de vive voix ou par SMS</b>. Il en aura besoin avec son e-mail (${esc(b.dataset.code)}) pour « Première fois ? ».</p>
          <p class="note">Valable jusqu'au ${esc(dateFr(String(r.valable_jusqu_au).slice(0, 10)))}. 5 essais au plus. Ce code ne sera plus affiché : si tu le perds, crées-en un nouveau (l'ancien ne marchera plus).</p>`);
      } catch (e) { alert(messageErreur(e)); }
      blocFamille(conteneur);
    }));
    $$('[data-mdp]', conteneur).forEach((b) => b.addEventListener('click', async () => {
      if (!confirm(`${b.dataset.nom} a oublié son mot de passe ?\n\nSon accès est suspendu. Ensuite, touche « Donner un code » : avec ce code, il pourra choisir un nouveau mot de passe pendant 3 jours (« Première fois ? »), puis tu valideras son retour ici.`)) return;
      b.disabled = true;
      try { await gerer('nouveau_mdp', { membre_id: b.dataset.mdp }); } catch (e) { alert(messageErreur(e)); }
      blocFamille(conteneur);
    }));
    $$('[data-valider]', conteneur).forEach((b) => b.addEventListener('click', async () => {
      if (!confirm(`Laisser entrer ${b.dataset.nom} dans l'appli ?`)) return;
      b.disabled = true;
      try { await gerer('valider', { membre_id: b.dataset.valider }); } catch (e) { alert(messageErreur(e)); }
      blocFamille(conteneur);
    }));
    $$('[data-bloquer]', conteneur).forEach((b) => b.addEventListener('click', async () => {
      if (!confirm(`Bloquer l'accès de ${b.dataset.nom} ? Tu pourras le valider à nouveau ensuite.`)) return;
      b.disabled = true;
      try { await gerer('bloquer', { membre_id: b.dataset.bloquer }); } catch (e) { alert(messageErreur(e)); }
      blocFamille(conteneur);
    }));
  }

  // =====================================================================
  // Bâtiments : liste + fiche de chaque bâtiment (avec ses documents)
  // =====================================================================
  const TYPES_BATIMENTS = { poulailler: ['Poulailler', 'egg_alt'], etable: ['Étable', 'pets'], porcherie: ['Porcherie', 'savings'], hangar: ['Hangar', 'warehouse'], maison: ['Maison', 'home'] };
  const typeBatiment = (t) => TYPES_BATIMENTS[t] || ['Bâtiment', 'home_work'];

  async function vueBatiments(el) {
    const b = await lire('batiments');
    const details = {};
    (b.details || []).forEach((d) => { details[d.code] = d; });
    const groupes = {};
    (b.liste || []).forEach((x) => { (groupes[x.type || 'autre'] = groupes[x.type || 'autre'] || []).push(x); });
    el.innerHTML = Object.keys(groupes).map((t) => `<div class="bloc"><h2>${icone(typeBatiment(t)[1])}${esc(typeBatiment(t)[0])}s</h2>
      <ul class="liste">${groupes[t].map((x) => {
        const d = details[String(x.nom).trim()] || null;
        const sous = d ? (x.statut === "projet" ? `en projet · surface prévue ${nf(d.surface_retenue_m2)} m²` : `surface retenue ${nf(d.surface_retenue_m2)} m²`) : (x.sci ? 'SCI · maison de location' : (x.statut === 'projet' ? 'en projet' : 'au sol ' + surfaceTexte(x.surface_m2)));
        return `<li><button data-batiment="${esc(x.objet_id)}"><span class="g"><b>${esc(x.nom)}</b><span class="doux">${esc(sous)}${x.nb_documents ? ' · ' + pluriel(x.nb_documents, 'document') : ''}</span></span></button></li>`;
      }).join('')}</ul></div>`).join('')
      + `<p class="note">Surfaces au sol mesurées sur le contour de la carte. Pour un poulailler, la surface officielle est celle de Maestro et Fermatel.</p>
      <button class="bouton-principal" data-aller="carte" style="width:100%">${icone('map')}Voir sur la carte</button>`;
    brancher(el);
    $$('[data-batiment]', el).forEach((bt) => bt.addEventListener('click', () => ouvrirBatiment(bt.dataset.batiment)));
  }
  function ouvrirBatiment(id) { ouvrir('Bâtiment', (el) => vueBatiment(el, id)); }

  async function vueBatiment(el, id) {
    const x = await lire('batiment', { objet_id: id });
    if (!x) { el.innerHTML = '<div class="bloc"><p>Bâtiment introuvable.</p></div>'; return; }
    titrePage(el, x.nom);
    const t = typeBatiment(x.type);
    const o = x.officiel;
    el.innerHTML = `
      <div class="bloc fiche-tete">
        <div class="numero-grand" style="font-size:26px">${esc(x.nom)}</div>
        <div class="badges"><span class="badge">${esc(t[0])}</span>${x.sci ? '<span class="badge">SCI</span>' : ''}${x.statut === 'projet' ? '<span class="badge">en projet</span>' : ''}${badgeEtatMaison(x)}</div>
        <div class="chiffres" style="margin-top:12px">
          ${o && o.surface_retenue_m2 ? chiffre(o.surface_retenue_m2, x.statut === 'projet' ? 'm² prévus (projet)' : 'm² officiels') : ''}
          ${chiffre(x.surface_m2, 'm² au sol (carte)')}
          ${x.logements ? chiffre(x.logements, x.logements > 1 ? 'logements' : 'logement') : ''}
        </div>
        ${x.lieu_dit ? ligne('Lieu-dit', esc(x.lieu_dit)) : ''}
        ${o ? ligne('Code', esc(o.code)) + (o.inuav ? ligne('INUAV', esc(o.inuav)) : '') + (o.surface_declaree_m2 && o.surface_declaree_m2 !== o.surface_retenue_m2 ? ligne('Ancienne déclaration', nf(o.surface_declaree_m2) + ' m²') : '') : ''}
        ${x.remarque ? `<p class="doux" style="margin:10px 0 0">${esc(x.remarque)}</p>` : ''}
      </div>
      ${x.geometrie ? `<div class="bloc" style="padding:0;overflow:hidden"><div id="mini-carte" class="mini-carte"></div></div>` : ''}
      <div id="docs-batiment"></div>
      <button class="bouton-principal" id="info-batiment" style="width:100%">${icone('add_circle')}Noter une info sur ce bâtiment</button>`;
    blocDocuments($('#docs-batiment', el), { type: 'batiment', id: x.objet_id, libelle: x.nom });
    $('#info-batiment', el).addEventListener('click', () => noter({ atelier: x.sci ? 'sci' : 'batiments', cible: x.nom, libelle: x.nom }));
    if (x.geometrie) miniCarte('mini-carte', [{ geo: x.geometrie }], { couleur: '#f2b134' });
  }

  // Petite carte fixe (photo IGN) avec une ou plusieurs formes, et une étiquette facultative sur chacune
  function miniCarte(idElement, formes, o) {
    setTimeout(() => {
      const zone = document.getElementById(idElement);
      if (!zone) return;
      const m = L.map(zone, { zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, touchZoom: false, boxZoom: false, keyboard: false });
      coucheIGN('ORTHOIMAGERY.ORTHOPHOTOS', 'image/jpeg').addTo(m);
      const groupe = L.featureGroup();
      formes.forEach((f) => {
        const forme = L.geoJSON(f.geo, { style: { color: '#ffffff', weight: 2, fillColor: f.couleur || (o && o.couleur) || '#34c759', fillOpacity: 0.45 } });
        if (f.etiquette) forme.bindTooltip(f.etiquette, { permanent: true, direction: 'center', className: 'etiquette-carte' });
        if (f.clic) forme.on('click', f.clic);
        forme.addTo(groupe);
      });
      groupe.addTo(m);
      try { m.fitBounds(groupe.getBounds(), { padding: [28, 28], maxZoom: 19 }); } catch (e) { m.setView([48.40, -3.76], 13); }
    }, 30);
  }

  // =====================================================================
  // SCI : les maisons de location, leurs papiers, les loyers et travaux notés
  // =====================================================================
  const numeroMaison = (id) => String(id || '').replace('carte-batiment-maison-sci-', '');
  const ETATS_MAISON = { louee: ['louée', 'vert'], en_renovation: ['en rénovation', 'orange'], vide: ['vide', ''], autre: ['autre', ''] };
  function badgeEtatMaison(m) {
    const e = m && m.etat && (ETATS_MAISON[m.etat] || [m.etat, '']);
    return e ? `<span class="badge ${e[1]}">${esc(e[0])}</span>` : '';
  }
  // « Lestrezec · louée · 2 logements » (seulement ce qui est connu)
  const resumeMaison = (m) => [m.lieu_dit, m.etat ? (ETATS_MAISON[m.etat] || [m.etat])[0] : '', m.logements ? pluriel(m.logements, 'logement') : ''].filter(Boolean).map(esc).join(' · ');

  async function vueSci(el) {
    const s = await lire('sci');
    const maisons = s.maisons || [];
    const ajouts = s.ajouts || [];
    const total = maisons.reduce((t, m) => t + Number(m.surface_m2 || 0), 0);
    const renovation = maisons.filter((m) => m.etat === 'en_renovation').length;
    // Une petite carte par endroit (maisons à moins de 400 m les unes des autres), sinon elles se chevauchent
    const sites = sitesMaisons(maisons.filter((m) => m.geometrie), 400);
    el.innerHTML = `
      <div class="bloc fiche-tete">
        <div class="sur-titre">Société civile immobilière</div>
        <div class="numero-grand" style="font-size:30px">SCI de la famille</div>
        <div class="badges"><span class="badge">${pluriel(maisons.length, 'maison')}</span>${renovation ? `<span class="badge orange">${renovation} en rénovation</span>` : ''}<span class="badge">${(s.documents || []).length ? pluriel(s.documents.length, 'document') : 'aucun document'}</span></div>
        <div class="chiffres" style="margin-top:12px">${chiffre(maisons.length, 'maisons')}${chiffre(total, 'm² au sol (carte)')}</div>
      </div>
      ${sites.map((g, i) => `<div class="bloc" style="padding:0;overflow:hidden">${sites.length > 1 ? `<div class="sur-titre" style="margin:12px 16px 8px">${esc(titreSite(g))}</div>` : ''}<div id="carte-sci-${i}" class="mini-carte"></div></div>`).join('')}
      <div class="bloc">
        <h2>${icone('home')}Les maisons</h2>
        <ul class="liste">${maisons.map((m) => `<li><button data-batiment="${esc(m.objet_id)}">
          <span class="pastille-num">${esc(numeroMaison(m.objet_id))}</span>
          <span class="g"><b>${esc(m.nom)}</b>${resumeMaison(m) ? `<span class="doux">${resumeMaison(m)}</span>` : ''}<span class="doux">${nf(m.surface_m2)} m² au sol${m.nb_documents ? ' · ' + pluriel(m.nb_documents, 'document') : ''}</span></span></button></li>`).join('')}</ul>
        <p class="note">Surfaces mesurées sur le contour de la carte (pas la surface habitable).</p>
      </div>
      <div id="docs-sci"></div>
      <div class="bloc">
        <h2>${icone('receipt_long')}Loyers, locataires, travaux</h2>
        ${ajouts.length ? `<ul class="fil">${ajouts.map((x) => `<li><div class="date">${esc(x.date_evenement ? dateFr(x.date_evenement) : dateFr(String(x.cree_le).slice(0, 10)))} · ${esc(x.auteur)}</div>
          <div>${icone(iconeFait(x.type), 'petite')} <b>${esc(nomFait(x.type))}</b></div><div class="doux">${esc(x.resume)}</div></li>`).join('')}</ul>`
          : '<p class="doux">Rien de noté pour l\'instant. Touche « Noter une info » : loyer reçu, nouveau locataire, travaux, facture…</p>'}
        <button class="bouton-principal" id="sci-noter" style="width:100%">${icone('add_circle')}Noter une info</button>
      </div>
      <div class="bloc">
        <h2>${icone('help')}Encore à compléter</h2>
        <p class="doux" style="margin-top:0">Ces infos ne sont pas encore dans la base. Ajoute les papiers ci-dessus ou note-les avec « Noter une info » :</p>
        <ul class="a-completer">
          <li>Nom exact de la SCI et son numéro (SIREN)</li><li>Associés et parts</li><li>Locataire et bail de chaque maison</li>
          <li>Montant des loyers</li><li>Emprunts en cours</li><li>Assurances et taxe foncière</li>
        </ul>
      </div>`;
    blocDocuments($('#docs-sci', el), { type: 'sci', id: null, libelle: 'SCI', titre: 'Papiers de la SCI', vide: 'Statuts, baux, assurances, taxe foncière, comptes : ajoute-les ici pour les retrouver.' });
    $$('[data-batiment]', el).forEach((bt) => bt.addEventListener('click', () => ouvrirBatiment(bt.dataset.batiment)));
    $('#sci-noter', el).addEventListener('click', () => noter({ atelier: 'sci', libelle: 'SCI' }));
    sites.forEach((g, i) => miniCarte('carte-sci-' + i, g.map((m) => ({ geo: m.geometrie, etiquette: numeroMaison(m.objet_id), couleur: '#f2b134', clic: () => ouvrirBatiment(m.objet_id) }))));
  }

  // Regroupe les maisons proches (distance entre centres < seuilM mètres), dans l'ordre de la liste
  function sitesMaisons(liste, seuilM) {
    const centre = (g) => { const a = g.type === 'MultiPolygon' ? g.coordinates[0][0] : g.coordinates[0]; return [a.reduce((s, p) => s + p[0], 0) / a.length, a.reduce((s, p) => s + p[1], 0) / a.length]; };
    const distM = (a, b) => Math.hypot((a[0] - b[0]) * 111320 * Math.cos(a[1] * Math.PI / 180), (a[1] - b[1]) * 110540);
    const groupes = [];
    liste.forEach((m) => {
      const c = centre(m.geometrie);
      const g = groupes.find((x) => distM(x.c, c) < seuilM);
      if (g) g.maisons.push(m); else groupes.push({ c, maisons: [m] });
    });
    return groupes.map((g) => g.maisons);
  }
  // « Lestrezec · maisons 4 et 5 » ou « Maisons 1, 2 et 3 »
  function titreSite(g) {
    const n = g.map((m) => numeroMaison(m.objet_id));
    const nums = n.length > 1 ? 'maisons ' + n.slice(0, -1).join(', ') + ' et ' + n[n.length - 1] : 'maison ' + n[0];
    const lieux = [...new Set(g.map((m) => m.lieu_dit).filter(Boolean))];
    return lieux.length === 1 ? lieux[0] + ' · ' + nums : nums.charAt(0).toUpperCase() + nums.slice(1);
  }

  // =====================================================================
  // Documents joints (coffre privé « famille-documents » : seuls les membres déposent et ouvrent)
  // =====================================================================
  const SEAU = 'famille-documents';
  const CATEGORIES_DOCS = [
    ['photo', 'Photo', 'photo_camera'], ['facture', 'Facture', 'receipt_long'], ['bail', 'Bail', 'key'], ['contrat', 'Contrat', 'handshake'],
    ['assurance', 'Assurance', 'shield'], ['analyse', 'Analyse', 'science'], ['ordonnance', 'Ordonnance, soin', 'medication'],
    ['plan', 'Plan', 'architecture'], ['courrier', 'Courrier', 'mail'], ['compte', 'Compte, bilan', 'account_balance'], ['autre', 'Autre', 'description']
  ];
  const categorieDoc = (c) => CATEGORIES_DOCS.find((x) => x[0] === c) || CATEGORIES_DOCS[CATEGORIES_DOCS.length - 1];
  const tailleTexte = (o) => (o == null ? '' : o >= 1048576 ? nf(o / 1048576, 1) + ' Mo' : nf(Math.max(1, o / 1024)) + ' ko');
  const estImage = (d) => /^image\/(jpeg|png|webp)/.test(d.type_mime || '');
  const iconeDoc = (d) => (/pdf/.test(d.type_mime || '') ? 'picture_as_pdf' : categorieDoc(d.categorie)[2]);
  const TYPES_PAR_EXTENSION = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif',
    txt: 'text/plain', csv: 'text/csv', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
  const invaliderDocs = () => Object.keys(cache).forEach((k) => { if (/^(documents|sci|batiment)/.test(k)) delete cache[k]; });

  const urlsSignees = {};
  async function signer(chemins) {
    const maintenant = Date.now();
    const manquants = chemins.filter((c) => !urlsSignees[c] || urlsSignees[c].t < maintenant);
    if (manquants.length) {
      const { data, error } = await sb.storage.from(SEAU).createSignedUrls(manquants, 3600);
      if (!error && data) data.forEach((x) => { if (x.signedUrl && x.path) urlsSignees[x.path] = { u: x.signedUrl, t: maintenant + 50 * 60 * 1000 }; });
    }
    const r = {};
    chemins.forEach((c) => { if (urlsSignees[c]) r[c] = urlsSignees[c].u; });
    return r;
  }

  // Si une vignette ne se charge pas (réseau, lien expiré), on remet l'icône du document.
  const secoursVignettes = (el) => $$('.vignette img', el).forEach((img) => img.addEventListener('error', () => {
    const v = img.parentNode;
    v.className = 'vignette';
    v.innerHTML = icone('image');
  }));

  function carteDocHtml(d, url, avecLieu) {
    const cat = categorieDoc(d.categorie);
    const vignette = estImage(d) && url ? `<img src="${esc(url)}" alt="" loading="lazy">` : icone(iconeDoc(d));
    return `<button class="doc" data-doc="${esc(d.id)}">
      <span class="vignette${estImage(d) && url ? ' photo' : ''}">${vignette}</span>
      <span class="txt"><b>${esc(d.titre)}</b>
        <span>${esc(cat[1])}${d.date_document ? ' · ' + esc(dateFr(d.date_document)) : ''}${avecLieu && d.rattache_libelle ? ' · ' + esc(d.rattache_libelle) : ''}</span>
        <span class="faible">${esc(d.auteur)} · ajouté le ${esc(dateFr(String(d.cree_le).slice(0, 10)))}</span></span>
      ${icone('chevron_right')}</button>`;
  }

  async function blocDocuments(conteneur, o) {
    if (!conteneur) return;
    const titre = o.titre || 'Documents';
    conteneur.innerHTML = `<div class="bloc"><h2>${icone('folder_open')}${esc(titre)}</h2><p class="doux">Chargement…</p></div>`;
    let docs = [];
    try { docs = (await lire('documents', o.id ? { type: o.type, id: o.id } : { type: o.type })) || []; } catch (e) { conteneur.innerHTML = ''; return; }
    let urls = {};
    try { urls = await signer(docs.filter(estImage).map((d) => d.chemin)); } catch (e) { /* vignettes facultatives */ }
    conteneur.innerHTML = `<div class="bloc">
      <h2>${icone('folder_open')}${esc(titre)}${docs.length ? ` <span class="doux" style="font-weight:500">· ${docs.length}</span>` : ''}</h2>
      ${docs.length ? `<div class="docs">${docs.map((d) => carteDocHtml(d, urls[d.chemin], o.avecLieu)).join('')}</div>`
        : `<p class="doux" style="margin-top:0">${esc(o.vide || 'Aucun document pour l\'instant. Photos, factures, papiers : ajoute-les ici pour les retrouver.')}</p>`}
      <button class="bouton-secondaire large" data-ajouter-doc>${icone('add_a_photo')}Ajouter un document</button></div>`;
    secoursVignettes(conteneur);
    const recharger = () => { invaliderDocs(); if (o.apres) o.apres(); else blocDocuments(conteneur, o); };
    $$('[data-doc]', conteneur).forEach((b) => b.addEventListener('click', () => ouvrirDocument(docs.find((d) => d.id === b.dataset.doc), recharger)));
    $('[data-ajouter-doc]', conteneur).addEventListener('click', () => formulaireDocument(o, recharger));
  }

  // Feuille qui monte du bas de l'écran (détail d'un document, ajout d'un document)
  // o.avantFermer() → false pour garder la feuille ouverte ; o.apresFermer() après fermeture
  function feuille(html, o) {
    o = o || {};
    const fond = document.createElement('div');
    fond.className = 'feuille-fond';
    fond.innerHTML = `<div class="feuille" role="dialog" aria-modal="true"><div class="poignee"></div><button class="feuille-fermer" aria-label="Fermer">${icone('close')}</button>${html}</div>`;
    document.body.appendChild(fond);
    document.body.classList.add('sans-defilement');
    requestAnimationFrame(() => fond.classList.add('ouvert'));
    const fermer = () => {
      if (o.avantFermer && o.avantFermer() === false) return;
      fond.classList.remove('ouvert');
      document.body.classList.remove('sans-defilement');
      setTimeout(() => fond.remove(), 220);
      if (o.apresFermer) o.apresFermer();
    };
    fond.addEventListener('click', (e) => { if (e.target === fond) fermer(); });
    $('.feuille-fermer', fond).addEventListener('click', fermer);
    return { el: $('.feuille', fond), fermer };
  }

  // =====================================================================
  // À faire : la liste partagée de la famille (travaux de la ferme : quoi, pour qui, pour quand)
  // =====================================================================
  async function aFaire(action, p) {
    const { data, error } = await sb.rpc('famille_a_faire_gerer', { p_action: action, p });
    if (error) throw error;
    return data;
  }
  const oublierAFaire = () => Object.keys(cache).filter((k) => k.startsWith('a_faire')).forEach((k) => delete cache[k]);
  const ATELIERS_A_FAIRE = [['bovins', 'Troupeau', 'pets'], ['volailles', 'Volailles', 'egg_alt'], ['cultures', 'Champs', 'grass'], ['batiments', 'Bâtiments', 'home_work'], ['sci', 'SCI', 'real_estate_agent'], ['autre', 'Autre', 'more_horiz']];
  function texteEcheance(t) {
    if (!t.echeance) return '';
    const reste = -joursDepuis(t.echeance);
    if (t.fait) return 'prévu le ' + dateFr(t.echeance, true);
    if (reste < 0) return `en retard de ${pluriel(-reste, 'jour')}`;
    if (reste === 0) return "pour aujourd'hui";
    if (reste === 1) return 'pour demain';
    return 'pour le ' + dateFr(t.echeance, true);
  }
  function ligneAFaire(t) {
    const retard = !t.fait && t.echeance && joursDepuis(t.echeance) > 0;
    const atelier = t.atelier ? (ATELIERS_A_FAIRE.find((a) => a[0] === t.atelier) || [])[1] : '';
    const meta = [t.pour ? (t.pour === 'tous' ? 'tout le monde' : 'pour ' + t.pour) : '', texteEcheance(t), atelier,
      t.fait ? (t.fait_par ? 'fait par ' + t.fait_par : 'fait') : (t.auteur ? 'noté par ' + t.auteur : '')].filter(Boolean).join(' · ');
    return `<li class="a-faire${t.fait ? ' fait' : ''}${retard ? ' retard' : ''}">
      <button class="case" data-cocher="${esc(t.id)}" data-fait="${t.fait ? '1' : ''}" aria-label="${t.fait ? 'Remettre à faire' : 'Marquer comme fait'}">${icone(t.fait ? 'check_circle' : 'radio_button_unchecked')}</button>
      <span class="g"><b>${esc(t.texte)}</b>${meta ? `<span class="doux">${esc(meta)}</span>` : ''}</span>
      ${t.a_moi ? `<button class="retirer" data-retirer="${esc(t.id)}" aria-label="Retirer de la liste">${icone('close')}</button>` : ''}
    </li>`;
  }
  function brancherAFaire(zone, apres) {
    $$('[data-cocher]', zone).forEach((b) => b.addEventListener('click', async () => {
      const fait = !b.dataset.fait;
      b.disabled = true;
      b.closest('.a-faire').classList.toggle('fait', fait);
      try { await aFaire('cocher', { id: b.dataset.cocher, fait }); oublierAFaire(); apres(); }
      catch (e) { b.disabled = false; b.closest('.a-faire').classList.toggle('fait', !fait); alert(messageErreur(e)); }
    }));
    $$('[data-retirer]', zone).forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Retirer cette ligne de la liste ?')) return;
      try { await aFaire('retirer', { id: b.dataset.retirer }); oublierAFaire(); apres(); } catch (e) { alert(messageErreur(e)); }
    }));
  }
  // Petit formulaire « Ajouter à faire »
  async function ajouterAFaire(apres, depart) {
    let infos = {};
    try { infos = await lire('a_faire'); } catch (e) { /* liste des personnes par défaut */ }
    const personnes = (infos.personnes && infos.personnes.length ? infos.personnes : ['Hugo', 'Hervé', 'Evan']);
    const etat = { pour: '', quand: '', atelier: (depart && depart.atelier) || '' };
    const isoJ = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const choix = (nom, liste, actif) => `<div class="puces puces-info" data-groupe="${nom}">${liste.map(([v, l]) => `<button type="button" class="puce${v === actif ? ' actif' : ''}" data-v="${esc(v)}">${esc(l)}</button>`).join('')}</div>`;
    let ecrit = false;
    const f = feuille(`<div id="af-corps"></div>`, { avantFermer: () => !ecrit || !$('#af-texte') || !$('#af-texte').value.trim() || confirm('Fermer sans ajouter ? Ce que tu as écrit sera perdu.') });
    const corps = $('#af-corps', f.el);
    const dessiner = () => {
      const texte = $('#af-texte', corps) ? $('#af-texte', corps).value : ((depart && depart.texte) || '');
      const date = $('#af-date', corps) ? $('#af-date', corps).value : '';
      corps.innerHTML = `<h2 class="feuille-titre">Ajouter à faire</h2>
        <label for="af-texte">Quoi ?</label>
        <textarea id="af-texte" class="champ-texte" rows="2" maxlength="300" placeholder="ex. Changer la bâche du silo · appeler le véto pour la 1142">${esc(texte)}</textarea>
        <label>Pour qui ?</label>
        ${choix('pour', [['', 'Personne en particulier']].concat(personnes.map((p) => [p, p])).concat([['tous', 'Tout le monde']]), etat.pour)}
        <label>Pour quand ?</label>
        ${choix('quand', [['', 'Pas de date'], ['0', "Aujourd'hui"], ['1', 'Demain'], ['7', 'Dans la semaine'], ['autre', 'Un jour précis']], etat.quand)}
        ${etat.quand === 'autre' ? `<input id="af-date" type="date" value="${esc(date)}" min="${isoJ(new Date())}">` : ''}
        <label>Atelier <span class="doux">(facultatif)</span></label>
        ${choix('atelier', [['', 'Aucun']].concat(ATELIERS_A_FAIRE.map((a) => [a[0], a[1]])), etat.atelier)}
        <button class="bouton-principal" id="af-ok" style="width:100%;margin-top:14px">${icone('add')}Ajouter à la liste</button>
        <p class="erreur" id="af-erreur"></p>
        <p class="note">Toute la famille voit la liste. Chacun peut cocher ce qui est fait ; seule la personne qui a écrit une ligne peut la retirer.</p>`;
      $$('.puces-info', corps).forEach((g) => $$('.puce', g).forEach((b) => b.addEventListener('click', () => { ecrit = true; etat[g.dataset.groupe] = b.dataset.v; dessiner(); })));
      $('#af-texte', corps).addEventListener('input', () => { ecrit = true; });
      $('#af-ok', corps).addEventListener('click', async () => {
        const t = $('#af-texte', corps).value.trim();
        const err = $('#af-erreur', corps);
        if (!t) { err.textContent = 'Écris ce qu\'il y a à faire.'; $('#af-texte', corps).focus(); return; }
        let echeance = null;
        if (etat.quand === 'autre') { echeance = ($('#af-date', corps) || {}).value || null; if (!echeance) { err.textContent = 'Choisis la date, ou « Pas de date ».'; return; } }
        else if (etat.quand !== '') { const d = new Date(); d.setDate(d.getDate() + Number(etat.quand)); echeance = isoJ(d); }
        const bt = $('#af-ok', corps); bt.disabled = true; bt.innerHTML = icone('hourglass_top') + 'Ajout…';
        try {
          await aFaire('ajouter', { texte: t, pour: etat.pour || null, echeance, atelier: etat.atelier || null });
          oublierAFaire(); ecrit = false; f.fermer(); if (apres) apres();
        } catch (e) { bt.disabled = false; bt.innerHTML = icone('add') + 'Ajouter à la liste'; err.textContent = messageErreur(e); }
      });
    };
    dessiner();
    setTimeout(() => { const z = $('#af-texte', corps); if (z && !z.value) z.focus(); }, 250);
  }
  // Page complète « À faire »
  let filtreAFaire = 'reste';
  async function vueAFaire(el) {
    const r = await lire('a_faire');
    const liste = (r && r.liste) || [];
    const moi = (r && r.moi) || '';
    const FILTRES = [['reste', 'À faire', (t) => !t.fait], ['moi', 'Pour moi', (t) => !t.fait && (t.pour === moi || t.pour === 'tous')], ['fait', 'Fait (14 j)', (t) => t.fait]];
    const f = FILTRES.find((x) => x[0] === filtreAFaire) || FILTRES[0];
    const l = liste.filter(f[2]);
    el.innerHTML = `
      <button class="bouton-principal" id="af-ajouter" style="width:100%;margin-bottom:12px">${icone('add_task')}Ajouter à faire</button>
      <div class="puces">${FILTRES.map(([id, lib, t]) => `<button class="puce${id === filtreAFaire ? ' actif' : ''}" data-filtre-af="${id}">${esc(lib)} (${nf(liste.filter(t).length)})</button>`).join('')}</div>
      <div class="bloc"><ul class="liste-a-faire">${l.map(ligneAFaire).join('') || `<li class="doux" style="padding:12px 0">${filtreAFaire === 'fait' ? 'Rien de coché ces 14 derniers jours.' : 'Rien à faire dans la liste.'}</li>`}</ul></div>
      <p class="note">Liste de la famille. Les lignes cochées restent visibles 14 jours.</p>`;
    const recharger = () => vueAFaire(el);
    $('#af-ajouter', el).addEventListener('click', () => ajouterAFaire(recharger));
    $$('[data-filtre-af]', el).forEach((b) => b.addEventListener('click', () => { filtreAFaire = b.dataset.filtreAf; vueAFaire(el); }));
    brancherAFaire(el, recharger);
  }
  // Bloc de l'accueil : les 5 prochaines choses à faire
  async function blocAFaireAccueil(zone) {
    if (!zone) return;
    let r;
    try { r = await lire('a_faire'); } catch (e) { zone.innerHTML = ''; return; }
    const reste = ((r && r.liste) || []).filter((t) => !t.fait);
    const montres = reste.slice(0, 5);
    zone.innerHTML = `<div class="bloc">
      <h2>${icone('checklist')}À faire ${reste.length ? `<span class="doux h2-doux">· ${nf(reste.length)}</span>` : ''}</h2>
      ${montres.length ? `<ul class="liste-a-faire">${montres.map(ligneAFaire).join('')}</ul>` : '<p class="doux" style="margin:0 0 4px">Rien dans la liste. Ajoute ce qu\'il y a à faire à la ferme : tout le monde le verra.</p>'}
      <div class="boutons-ligne"><button class="bouton-secondaire" id="af-accueil-ajouter">${icone('add')}Ajouter</button>${reste.length ? `<button class="bouton-discret" id="af-accueil-tout">Tout voir</button>` : ''}</div>
    </div>`;
    const recharger = () => blocAFaireAccueil(zone);
    $('#af-accueil-ajouter', zone).addEventListener('click', () => ajouterAFaire(recharger));
    const tout = $('#af-accueil-tout', zone); if (tout) tout.addEventListener('click', () => ouvrir(PAGES.a_faire[0], PAGES.a_faire[1]));
    brancherAFaire(zone, recharger);
  }

  async function ouvrirDocument(d, apres) {
    if (!d) return;
    let u = null;
    try { u = (await signer([d.chemin]))[d.chemin] || null; } catch (e) { /* lien indisponible */ }
    let moi = {};
    try { moi = await lire('moi'); } catch (e) { /* bouton retirer masqué */ }
    const cat = categorieDoc(d.categorie);
    const peutRetirer = moi.role === 'admin' || moi.nom === d.auteur;
    const f = feuille(`
      ${estImage(d) && u ? `<img class="apercu-grand" src="${esc(u)}" alt="">` : `<div class="apercu-icone">${icone(iconeDoc(d))}</div>`}
      <h2 class="feuille-titre">${esc(d.titre)}</h2>
      ${ligne('Type', esc(cat[1]))}
      ${d.date_document ? ligne('Date du document', esc(dateFr(d.date_document))) : ''}
      ${d.rattache_libelle ? ligne('Pour', esc(d.rattache_libelle)) : ''}
      ${ligne('Ajouté par', esc(d.auteur) + '<br><span class="doux">le ' + esc(dateFr(String(d.cree_le).slice(0, 10))) + '</span>')}
      ${d.taille_octets ? ligne('Taille', esc(tailleTexte(d.taille_octets))) : ''}
      ${d.remarque ? `<p>${esc(d.remarque)}</p>` : ''}
      <div class="feuille-boutons">
        ${u ? `<a class="bouton-principal" href="${esc(u)}" target="_blank" rel="noopener">${icone('open_in_new')}Ouvrir</a>` : '<p class="erreur">Fichier impossible à ouvrir pour l\'instant. Vérifie le réseau.</p>'}
        ${peutRetirer ? `<button class="bouton-secondaire" id="doc-retirer">${icone('visibility_off')}Retirer</button>` : ''}
      </div>
      ${peutRetirer ? '<p class="note">« Retirer » cache le document dans l\'appli ; le fichier reste gardé.</p>' : ''}`);
    const bRetirer = $('#doc-retirer', f.el);
    if (bRetirer) bRetirer.addEventListener('click', async () => {
      if (!confirm('Retirer ce document de l\'appli ? Le fichier reste gardé.')) return;
      bRetirer.disabled = true;
      const { error } = await sb.rpc('famille_document_retirer', { p_id: d.id });
      if (error) { alert(messageErreur(error)); bRetirer.disabled = false; return; }
      f.fermer();
      apres();
    });
  }

  // Réduit une grosse photo avant l'envoi (réseau de campagne) ; les autres fichiers partent tels quels.
  async function preparerFichier(f) {
    if (!/^image\/(jpeg|png|webp)$/.test(f.type) || f.size < 2.5 * 1048576 || !window.createImageBitmap) return f;
    try {
      const bmp = await createImageBitmap(f);
      const r = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * r); c.height = Math.round(bmp.height * r);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      const blob = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.85));
      return blob && blob.size < f.size ? new File([blob], f.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' }) : f;
    } catch (e) { return f; }
  }
  const identifiantUnique = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
  const nettoyerChemin = (t) => String(t || 'general').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, 60) || 'general';

  function formulaireDocument(o, apres) {
    const f = feuille(`
      <h2 class="feuille-titre">Ajouter un document</h2>
      <p class="doux" style="margin-top:0">Pour : <b>${esc(o.libelle || 'la ferme')}</b></p>
      <div class="choix-fichier">
        <label class="gros-choix">${icone('photo_camera')}<span>Prendre une photo</span><input type="file" accept="image/*" capture="environment" data-fichier hidden></label>
        <label class="gros-choix">${icone('upload_file')}<span>Choisir un fichier</span><input type="file" accept="image/*,application/pdf,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt" data-fichier hidden></label>
      </div>
      <div id="apercu-fichier"></div>
      <div id="champs-doc" hidden>
        <label for="doc-titre">Titre</label><input id="doc-titre" maxlength="200" placeholder="ex. Facture vétérinaire, bail maison 1…">
        <label for="doc-cat">Type de document</label>
        <select id="doc-cat">${CATEGORIES_DOCS.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select>
        <label for="doc-date">Date du document <span class="doux">(facultatif)</span></label><input id="doc-date" type="date">
        <label for="doc-remarque">Remarque <span class="doux">(facultatif)</span></label><input id="doc-remarque" maxlength="300">
        <button class="bouton-principal" id="doc-envoyer" style="width:100%">${icone('cloud_upload')}Enregistrer le document</button>
      </div>
      <p class="erreur" id="doc-erreur"></p>`);
    let fichier = null;
    $$('[data-fichier]', f.el).forEach((inp) => inp.addEventListener('change', () => {
      const x = inp.files && inp.files[0];
      if (!x) return;
      if (x.size > 25 * 1048576) { $('#doc-erreur', f.el).textContent = 'Fichier trop gros (25 Mo au plus).'; return; }
      fichier = x;
      $('#doc-erreur', f.el).textContent = '';
      const image = /^image\//.test(x.type);
      const apercu = $('#apercu-fichier', f.el);
      apercu.innerHTML = `<div class="fichier-choisi">${image ? '<img alt="">' : icone(/pdf/.test(x.type) ? 'picture_as_pdf' : 'description')}<span class="txt"><b>${esc(x.name)}</b><span class="doux">${esc(tailleTexte(x.size))}</span></span></div>`;
      if (image) { const img = $('img', apercu); img.src = URL.createObjectURL(x); img.onload = () => URL.revokeObjectURL(img.src); }
      $('#champs-doc', f.el).hidden = false;
      if (!$('#doc-titre', f.el).value) $('#doc-titre', f.el).value = image && /^(IMG|DSC|PXL|image|photo)[-_ ]?\d*/i.test(x.name) ? '' : x.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').slice(0, 120);
      $('#doc-cat', f.el).value = image ? 'photo' : (o.type === 'sci' ? 'bail' : 'autre');
      if (image && !$('#doc-date', f.el).value) $('#doc-date', f.el).value = new Date(x.lastModified || Date.now()).toISOString().slice(0, 10);
      $('#doc-titre', f.el).focus();
    }));
    $('#doc-envoyer', f.el).addEventListener('click', async () => {
      const err = $('#doc-erreur', f.el), bt = $('#doc-envoyer', f.el);
      const cat = $('#doc-cat', f.el).value;
      const titre = $('#doc-titre', f.el).value.trim() || (categorieDoc(cat)[1] + ' du ' + dateFr(new Date().toISOString().slice(0, 10)));
      if (!fichier) { err.textContent = 'Choisis d\'abord une photo ou un fichier.'; return; }
      err.textContent = ''; bt.disabled = true; bt.innerHTML = icone('cloud_upload') + 'Envoi en cours…';
      try {
        const pret = await preparerFichier(fichier);
        const ext = (pret.name.match(/\.([A-Za-z0-9]+)$/) || [, ''])[1].toLowerCase() || (pret.type === 'application/pdf' ? 'pdf' : 'bin');
        const type = pret.type || TYPES_PAR_EXTENSION[ext] || 'application/octet-stream';
        const chemin = `${o.type}/${nettoyerChemin(o.id || o.type)}/${new Date().toISOString().slice(0, 10)}-${identifiantUnique()}.${ext}`;
        const { error: e1 } = await sb.storage.from(SEAU).upload(chemin, pret, { contentType: type, upsert: false });
        if (e1) throw e1;
        const { error: e2 } = await sb.rpc('famille_document_enregistrer', { p: {
          rattache_type: o.type, rattache_id: o.id || null, rattache_libelle: o.libelle || null, titre, categorie: cat,
          date_document: $('#doc-date', f.el).value || null, remarque: $('#doc-remarque', f.el).value.trim() || null,
          chemin, nom_fichier: fichier.name, type_mime: type } });
        if (e2) throw e2;
        f.fermer();
        apres();
      } catch (e) {
        const m = String((e && e.message) || e);
        err.textContent = /mime|type/i.test(m) ? 'Ce type de fichier n\'est pas accepté (photo, PDF, Word, Excel ou texte).' : /size|large|exceed/i.test(m) ? 'Fichier trop gros (25 Mo au plus).' : messageErreur(e);
        bt.disabled = false; bt.innerHTML = icone('cloud_upload') + 'Enregistrer le document';
      }
    });
  }

  // =====================================================================
  // Noter une info sans l'IA (vêlage, soin, loyer, remarque…) → famille_ajouter, statut « à intégrer »
  // o : { atelier, numero_animal, lot, parcelle, cible (texte libre : maison, bâtiment…), libelle }
  // =====================================================================
  const ATELIERS_INFO = [
    ['bovins', 'Troupeau', 'pets', ['velage', 'soin', 'mort', 'vente', 'achat', 'remarque']],
    ['volailles', 'Volailles', 'egg_alt', ['remarque', 'comptage', 'soin', 'travaux']],
    ['cultures', 'Champs', 'grass', ['remarque', 'travaux', 'mesure']],
    ['porcs', 'Porcs', 'savings', ['remarque', 'soin', 'mort', 'vente', 'travaux']],
    ['batiments', 'Bâtiments', 'home_work', ['travaux', 'remarque', 'depense']],
    ['sci', 'SCI', 'real_estate_agent', ['loyer', 'locataire', 'travaux', 'depense', 'remarque']],
    ['autre', 'Autre', 'more_horiz', ['remarque', 'depense', 'travaux']]
  ];
  const AIDES_INFO = {
    velage: 'ex. vêlage de nuit, veau vigoureux', soin: 'ex. boiterie, piqûre faite par le véto', mort: 'ex. trouvée morte au pré',
    vente: 'ex. partie chez le marchand', achat: 'ex. taureau acheté à Plounéour', remarque: 'Ce que tu veux garder en mémoire',
    comptage: 'ex. 12 morts ramassés ce matin', travaux: 'ex. abreuvoir réparé, chaudière changée', mesure: 'ex. 40 mm de pluie',
    loyer: 'ex. loyer d\'octobre reçu', locataire: 'ex. nouveau locataire le 1er décembre', depense: 'ex. facture plombier'
  };
  const DECLARATION_EDE = ['velage', 'mort', 'vente', 'achat'];

  function formulaireInfo(o, apres) {
    o = o || {};
    const atelierDepart = ATELIERS_INFO.some((a) => a[0] === o.atelier) ? o.atelier : 'bovins';
    const etat = { atelier: atelierDepart, type: null, quand: 'auj', sexe: '', facilite: '' };
    const typesDepart = ATELIERS_INFO.find((a) => a[0] === etat.atelier)[3];
    etat.type = o.type && typesDepart.includes(o.type) ? o.type : typesDepart[0];
    let enregistreAuMoinsUne = false, saisieEnCours = true;
    const f = feuille(`<div id="info-corps"></div>`, {
      // Ne pas perdre une saisie en touchant le fond par erreur
      avantFermer: () => { if (!saisieEnCours) return true; lireChamps(); return !aSaisi() || confirm('Fermer sans enregistrer ? Ce que tu as écrit sera perdu.'); },
      apresFermer: () => { if (enregistreAuMoinsUne && apres) apres(); }
    });
    const corps = $('#info-corps', f.el);
    const auj = new Date();
    const isoJour = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const valeurs = { numero: o.numero_animal || '', lot: o.lot || '', parcelle: o.parcelle || '', cible: o.cible || '', veau: '', produit: '', montant: '', texte: o.texte || '', date: isoJour(auj) };

    const puces = (nom, liste, actif) => `<div class="puces puces-info" data-groupe="${nom}">${liste.map(([v, l, ic]) =>
      `<button type="button" class="puce${v === actif ? ' actif' : ''}" data-v="${esc(v)}">${ic ? icone(ic) : ''}${esc(l)}</button>`).join('')}</div>`;
    const champTexte = (id, label, val, attrs) => `<label for="${id}">${label}</label><input id="${id}" value="${esc(val)}" ${attrs || ''}>`;

    function lireChamps() {
      [['info-numero', 'numero'], ['info-lot', 'lot'], ['info-parcelle', 'parcelle'], ['info-cible', 'cible'], ['info-veau', 'veau'], ['info-produit', 'produit'],
        ['info-montant', 'montant'], ['info-texte', 'texte'], ['info-date', 'date']].forEach(([id, k]) => { const x = $('#' + id, corps); if (x) valeurs[k] = x.value; });
    }
    // Seuls les champs affichés pour cet atelier et ce type comptent (pas ceux d'un choix précédent)
    function utiles() {
      const a = etat.atelier, t = etat.type, v = (k) => String(valeurs[k] || '').trim();
      return {
        numero: a === 'bovins' || a === 'porcs' ? v('numero') : '',
        lot: a === 'volailles' ? v('lot') : '',
        parcelle: a === 'cultures' ? v('parcelle') : '',
        cible: a === 'sci' || a === 'batiments' ? v('cible') : '',
        veau: t === 'velage' ? v('veau') : '', sexe: t === 'velage' ? etat.sexe : '', facilite: t === 'velage' ? etat.facilite : '',
        produit: t === 'soin' ? v('produit') : '',
        montant: t === 'loyer' || t === 'depense' ? v('montant') : '',
        texte: v('texte')
      };
    }
    const aSaisi = () => {
      const u = utiles();
      return !!(u.veau || u.sexe || u.facilite || u.produit || u.montant || (u.texte && u.texte !== (o.texte || ''))
        || (u.numero && u.numero !== (o.numero_animal || '')) || (u.cible && u.cible !== (o.cible || '')));
    };

    function dessiner() {
      const at = ATELIERS_INFO.find((a) => a[0] === etat.atelier);
      const t = etat.type;
      corps.innerHTML = `
        <h2 class="feuille-titre">Noter une info</h2>
        ${o.libelle ? `<p class="doux" style="margin-top:0">Pour : <b>${esc(o.libelle)}</b></p>` : ''}
        <label>C'est pour</label>
        ${puces('atelier', ATELIERS_INFO.map((a) => [a[0], a[1], a[2]]), etat.atelier)}
        <label>C'est quoi ?</label>
        ${puces('type', at[3].map((k) => [k, nomFait(k), iconeFait(k)]), t)}
        ${etat.atelier === 'bovins' || etat.atelier === 'porcs' ? champTexte('info-numero', etat.atelier === 'bovins' ? 'Numéro de la bête' : 'Numéro ou groupe <span class="doux">(facultatif)</span>', valeurs.numero, 'inputmode="numeric" autocomplete="off" placeholder="ex. 1142"') : ''}
        ${etat.atelier === 'volailles' ? champTexte('info-lot', 'Poulailler ou lot <span class="doux">(facultatif)</span>', valeurs.lot, 'placeholder="ex. P2, lot du 10 sept."') : ''}
        ${etat.atelier === 'cultures' ? champTexte('info-parcelle', 'Champ <span class="doux">(facultatif)</span>', valeurs.parcelle, 'placeholder="ex. Parc an dour"') : ''}
        ${etat.atelier === 'sci' || etat.atelier === 'batiments' ? champTexte('info-cible', (etat.atelier === 'sci' ? 'Maison' : 'Bâtiment') + ' <span class="doux">(facultatif)</span>', valeurs.cible, `placeholder="${etat.atelier === 'sci' ? 'ex. maison 1' : 'ex. hangar de Kernevez'}"`) : ''}
        ${t === 'velage' ? `<label>Le veau <span class="doux">(facultatif)</span></label>${puces('sexe', [['femelle', 'Femelle'], ['mâle', 'Mâle'], ['jumeaux', 'Jumeaux']], etat.sexe)}
          <label>Le vêlage <span class="doux">(facultatif)</span></label>${puces('facilite', [['tout seul', 'Tout seul'], ['aidé', 'Aidé'], ['avec le véto', 'Avec le véto']], etat.facilite)}
          ${champTexte('info-veau', 'Numéro du veau <span class="doux">(facultatif)</span>', valeurs.veau, 'inputmode="numeric" autocomplete="off"')}` : ''}
        ${t === 'soin' ? champTexte('info-produit', 'Produit ou traitement <span class="doux">(facultatif)</span>', valeurs.produit, 'autocomplete="off"') : ''}
        ${t === 'loyer' || t === 'depense' ? champTexte('info-montant', 'Montant en € <span class="doux">(facultatif)</span>', valeurs.montant, 'inputmode="decimal" autocomplete="off" placeholder="ex. 550"') : ''}
        <label>Quand ?</label>
        ${puces('quand', [['auj', "Aujourd'hui"], ['hier', 'Hier'], ['autre', 'Un autre jour'], ['inconnu', 'Je ne sais pas']], etat.quand)}
        ${etat.quand === 'autre' ? `<input id="info-date" type="date" value="${esc(valeurs.date)}" max="${isoJour(auj)}">` : ''}
        <label for="info-texte">En quelques mots ${t === 'remarque' ? '' : '<span class="doux">(facultatif)</span>'}</label>
        <textarea id="info-texte" class="champ-texte" rows="3" maxlength="400" placeholder="${esc(AIDES_INFO[t] || '')}">${esc(valeurs.texte)}</textarea>
        <button class="bouton-principal" id="info-enregistrer" style="width:100%;margin-top:14px">${icone('check')}Enregistrer</button>
        <p class="erreur" id="info-erreur"></p>
        <p class="note">L'info est gardée telle quelle, marquée « à intégrer » : Claude ou GPT la reportent ensuite dans le registre de l'atelier.${DECLARATION_EDE.includes(t) && etat.atelier === 'bovins' ? ' <b>L\'appli ne déclare rien à l\'EDE</b> : la déclaration se fait comme d\'habitude.' : ''}</p>`;

      $$('.puces-info', corps).forEach((g) => $$('.puce', g).forEach((b) => b.addEventListener('click', () => {
        lireChamps();
        const v = b.dataset.v;
        if (g.dataset.groupe === 'atelier') { etat.atelier = v; etat.type = ATELIERS_INFO.find((a) => a[0] === v)[3][0]; }
        else if (g.dataset.groupe === 'sexe' || g.dataset.groupe === 'facilite') etat[g.dataset.groupe] = etat[g.dataset.groupe] === v ? '' : v; // retouche = enlève
        else etat[g.dataset.groupe] = v;
        dessiner();
      })));
      $('#info-enregistrer', corps).addEventListener('click', enregistrer);
    }

    function resume() {
      const t = etat.type, u = utiles();
      const morceaux = [];
      if (t === 'velage') {
        morceaux.push('Vêlage' + (u.numero ? ' de la ' + u.numero : ''));
        const d = [u.sexe === 'jumeaux' ? 'jumeaux' : u.sexe ? 'veau ' + u.sexe : '', u.veau ? 'n° ' + u.veau : '', u.facilite].filter(Boolean);
        if (d.length) morceaux[0] += ' : ' + d.join(', ');
      } else {
        const cible = u.numero ? 'n° ' + u.numero : u.lot || u.parcelle || u.cible;
        morceaux.push(nomFait(t) + (cible ? ' · ' + cible : ''));
        if (u.produit) morceaux[0] += ' : ' + u.produit;
        if (u.montant) morceaux[0] += ' · ' + u.montant.replace('.', ',') + ' €';
      }
      if (u.texte) morceaux.push(u.texte);
      return morceaux.join(' — ');
    }

    async function enregistrer() {
      lireChamps();
      const err = $('#info-erreur', corps), bt = $('#info-enregistrer', corps);
      const t = etat.type, u = utiles();
      if (t === 'remarque' && !u.texte) { err.textContent = 'Écris la remarque en quelques mots.'; $('#info-texte', corps).focus(); return; }
      if (etat.atelier === 'bovins' && t !== 'remarque' && t !== 'achat' && !u.numero) { err.textContent = 'Indique le numéro de la bête.'; $('#info-numero', corps).focus(); return; }
      let date = null;
      if (etat.quand === 'auj') date = isoJour(auj);
      else if (etat.quand === 'hier') date = isoJour(new Date(auj.getTime() - 86400000));
      else if (etat.quand === 'autre') { date = valeurs.date || null; if (!date) { err.textContent = 'Choisis la date, ou « Je ne sais pas ».'; return; } }
      const donnees = {};
      if (u.sexe) donnees.sexe_veau = u.sexe;
      if (u.veau) donnees.numero_veau = u.veau;
      if (u.facilite) donnees.velage = u.facilite;
      if (u.produit) donnees.produit = u.produit;
      if (u.montant) donnees.montant_eur = u.montant.replace(',', '.');
      if (u.cible) donnees[etat.atelier === 'sci' ? 'maison' : 'batiment'] = u.cible;
      err.textContent = ''; bt.disabled = true; bt.innerHTML = icone('hourglass_top') + 'Enregistrement…';
      const paquet = {
        atelier: etat.atelier, type: t,
        numero_animal: u.numero || null, lot: u.lot || null, parcelle: u.parcelle || null,
        date_evenement: date, precision_date: date ? 'jour' : 'inconnue',
        resume: resume(), donnees, texte_origine: u.texte || null, via: 'appli-formulaire'
      };
      let error = null;
      try { ({ error } = await sb.rpc('famille_ajouter', { p_donnees: paquet })); } catch (e) { error = e; }
      // Pas de réseau : l'info est gardée sur le téléphone et partira toute seule quand le réseau revient
      const sansReseau = error && estErreurReseau(error);
      if (sansReseau) mettreEnAttente(paquet);
      if (error && !sansReseau) { err.textContent = messageErreur(error) + ' Ta saisie est gardée : réessaie.'; bt.disabled = false; bt.innerHTML = icone('check') + 'Enregistrer'; return; }
      if (!sansReseau) viderCache();
      enregistreAuMoinsUne = true; saisieEnCours = false;
      corps.innerHTML = `<div class="info-ok">${icone(sansReseau ? 'cloud_upload' : 'check_circle', 'plein')}<h2 class="feuille-titre" style="margin:8px 0">${sansReseau ? 'Gardé sur le téléphone' : 'C\'est noté'}</h2>
        <p class="doux">${esc(resume())}</p>
        <p class="doux">${sansReseau ? 'Pas de réseau : l\'info partira toute seule dès que le téléphone retrouve du réseau.' : 'Tu la retrouves dans « Plus › Infos ajoutées par la famille ».'}</p>
        <div class="feuille-boutons"><button class="bouton-secondaire" id="info-encore">${icone('add')}Noter autre chose</button><button class="bouton-principal" id="info-fermer">Fermer</button></div></div>`;
      $('#info-fermer', corps).addEventListener('click', () => f.fermer());
      $('#info-encore', corps).addEventListener('click', () => {
        Object.assign(valeurs, { veau: '', produit: '', montant: '', texte: '' });
        etat.sexe = ''; etat.facilite = ''; saisieEnCours = true;
        dessiner();
      });
    }
    dessiner();
  }

  // Tous les documents de la famille, par type
  let filtreDocs = 'tous';
  async function vueDocuments(el) {
    const docs = (await lire('documents', {})) || [];
    let urls = {};
    try { urls = await signer(docs.filter(estImage).map((d) => d.chemin)); } catch (e) { /* vignettes facultatives */ }
    const presentes = CATEGORIES_DOCS.filter(([k]) => docs.some((d) => d.categorie === k));
    const dessiner = () => {
      const liste = docs.filter((d) => filtreDocs === 'tous' || d.categorie === filtreDocs);
      el.innerHTML = `
        ${docs.length ? `<div class="puces"><button class="puce${filtreDocs === 'tous' ? ' actif' : ''}" data-filtre="tous">Tous · ${docs.length}</button>
          ${presentes.map(([k, l]) => `<button class="puce${filtreDocs === k ? ' actif' : ''}" data-filtre="${k}">${esc(l)}</button>`).join('')}</div>` : ''}
        <div class="bloc">
          <h2>${icone('folder_open')}Documents de la famille</h2>
          ${liste.length ? `<div class="docs">${liste.map((d) => carteDocHtml(d, urls[d.chemin], true)).join('')}</div>`
            : '<p class="doux" style="margin-top:0">Aucun document pour l\'instant. On peut en joindre sur une vache, un lot, un champ, un bâtiment ou la SCI, ou ici pour la ferme en général.</p>'}
        </div>
        <div id="docs-ferme"></div>`;
      $$('[data-filtre]', el).forEach((b) => b.addEventListener('click', () => { filtreDocs = b.dataset.filtre; dessiner(); }));
      secoursVignettes(el);
      $$('[data-doc]', el).forEach((b) => b.addEventListener('click', () => ouvrirDocument(docs.find((d) => d.id === b.dataset.doc), () => { invaliderDocs(); afficher(vueCourante); })));
      blocDocuments($('#docs-ferme', el), { type: 'ferme', id: null, libelle: 'La ferme (général)', titre: 'Papiers de la ferme en général', vide: 'PAC, comptabilité, assurances, contrats : ce qui ne concerne pas une bête, un lot ou un champ en particulier.', apres: () => afficher(vueCourante) });
    };
    if (filtreDocs !== 'tous' && !presentes.some(([k]) => k === filtreDocs)) filtreDocs = 'tous';
    dessiner();
  }

  // =====================================================================
  // Nos sources : d'où viennent les chiffres (registre public.sources_ferme)
  // =====================================================================
  const ATELIERS_SOURCES = [['volailles', 'Volailles', 'egg_alt'], ['bovins', 'Troupeau', 'pets'], ['cultures', 'Champs et carte', 'grass'],
    ['porcs', 'Porcs', 'savings'], ['batiments_sci', 'Bâtiments et SCI', 'home_work'], ['ferme', 'Toute la ferme', 'agriculture']];
  const STATUTS_SOURCE = { branche: ['branchée', 'vert'], partiel: ['en partie', 'orange'], a_faire: ['à faire', ''], a_decider: ['à décider', ''], indisponible: ['pas disponible', ''] };
  const MODES_SOURCE = { automatique: 'automatique', a_la_demande: 'à la demande (Claude ou GPT)', manuel: 'noté à la main', papier: 'papiers ou photos', pas_encore: 'pas encore récupérée' };
  async function vueSources(el) {
    const s = (await lire('sources')) || [];
    const n = (st) => s.filter((x) => x.statut === st).length;
    const carte = (x) => {
      const st = STATUTS_SOURCE[x.statut] || [x.statut, ''];
      return `<details class="source"><summary>
          <span class="g"><b>${esc(x.nom)}</b><span class="doux">${esc(MODES_SOURCE[x.mode] || x.mode)}${x.derniere_maj ? ' · à jour du ' + esc(dateFr(x.derniere_maj)) : ''}</span></span>
          <span class="badge ${st[1]}">${esc(st[0])}</span></summary>
        <div class="source-detail">
          ${x.ce_quon_en_tire ? `<p><b>Ce qu'on en tire :</b> ${esc(x.ce_quon_en_tire)}</p>` : ''}
          ${x.ce_qui_manque ? `<p><b>Ce qui manque :</b> ${esc(x.ce_qui_manque)}</p>` : ''}
          ${x.acces ? `<p><b>Accès :</b> ${esc(x.acces)}${x.organisme ? ' · ' + esc(x.organisme) : ''}</p>` : x.organisme ? `<p><b>Qui :</b> ${esc(x.organisme)}</p>` : ''}
          ${x.regles ? `<p class="doux">${icone('lock', 'petite')} ${esc(x.regles)}</p>` : ''}
          ${x.remarque ? `<p class="doux">${esc(x.remarque)}</p>` : ''}
        </div></details>`;
    };
    el.innerHTML = `
      <div class="bloc fiche-tete">
        <div class="sur-titre">D'où viennent les chiffres</div>
        <div class="numero-grand" style="font-size:28px">Nos sources</div>
        <div class="chiffres" style="margin-top:12px">${chiffre(n('branche'), 'branchées')}${chiffre(n('partiel'), 'en partie')}${chiffre(n('a_faire') + n('a_decider'), 'à faire ou à décider')}${chiffre(n('indisponible'), 'pas disponibles')}</div>
        <p class="note" style="margin:10px 0 0">Les sites sont lus en consultation seule : rien n'y est jamais saisi, validé ni déclaré par l'IA. Touche une source pour voir ce qu'on en tire et ce qui manque.</p>
      </div>
      ${ATELIERS_SOURCES.map(([a, nom, ico]) => { const l = s.filter((x) => x.atelier === a); return l.length ? `<div class="bloc"><h2>${icone(ico)}${esc(nom)}</h2>${l.map(carte).join('')}</div>` : ''; }).join('')}
      <button class="bouton-principal" id="sources-noter" style="width:100%">${icone('add_circle')}Ajouter ou corriger une source</button>`;
    $('#sources-noter', el).addEventListener('click', () => noter({ atelier: 'autre', libelle: 'Nos sources' }));
  }

  async function vueTaches(el) {
    const t = await lire('taches');
    const parAtelier = {};
    t.forEach((x) => { (parAtelier[x.atelier] = parAtelier[x.atelier] || []).push(x); });
    el.innerHTML = Object.keys(parAtelier).sort().map((a) => `<details class="bloc rubrique"${a === 'volailles' || a === 'bovins' ? ' open' : ''}>
      <summary><h2>${icone(ICONES_ATELIERS[a] || 'task')}${esc(NOMS_ATELIERS[a] || a)} <span class="doux" style="font-weight:500">· ${parAtelier[a].length}</span></h2></summary>
      ${parAtelier[a].map((x) => `<div class="ligne" style="display:block"><div>${esc(x.tache.length > 260 ? x.tache.slice(0, 260) + '…' : x.tache)}</div>
        <div class="doux">${x.statut === 'en_cours' ? '<span class="etiquette">en cours</span> ' : ''}depuis le ${esc(dateFr(x.a_partir_du))}</div></div>`).join('')}
    </details>`).join('') || '<div class="bloc"><p class="doux">Aucune tâche ouverte.</p></div>';
  }

  // Résumé d'une note : champs « fait » / « suite » envoyés à part, sinon lecture du texte (qui peut être coupé).
  function resumeNote(x) {
    const prendre = (v) => Array.isArray(v) ? v.join(' ') : (typeof v === 'string' ? v : '');
    const couper = (t, n) => t.slice(0, n) + (t.length > n ? '…' : '');
    let fait = prendre(x.fait), suite = prendre(x.suite);
    if (!fait) {
      let o = x.contenu;
      try { if (typeof o === 'string') o = JSON.parse(o); } catch (e) { o = null; }
      if (o && typeof o === 'object') { fait = prendre(o.fait); suite = suite || prendre(o.prochaine_etape); }
      else {
        const m = String(x.contenu || '').match(/"fait"\s*:\s*\[?\s*"((?:[^"\\]|\\.)*)"/);
        fait = m ? m[1].replace(/\\"/g, '"') : '';
      }
    }
    return { fait: couper(fait, 420), suite: couper(suite, 260) };
  }

  async function vueJournal(el) {
    const n = await lire('notes', { nombre: 15 });
    el.innerHTML = `<div class="bloc"><ul class="fil">${n.map((x) => {
      const r = resumeNote(x);
      return `<li><div class="date">${esc(dateFr(x.date))} · ${esc(NOMS_ATELIERS[x.atelier] || x.atelier || '')}</div>
        <div><b>${esc(x.titre || '')}</b></div>
        ${r.fait ? `<div class="doux">${esc(r.fait)}</div>` : ''}
        ${r.suite ? `<div class="doux"><b>Ensuite :</b> ${esc(r.suite)}</div>` : ''}</li>`;
    }).join('')}</ul></div><p class="note">Notes de travail écrites par Claude et GPT après chaque séance.</p>`;
  }

  async function vueAjouts(el) {
    const a = await lire('ajouts', { nombre: 60 });
    el.innerHTML = `<button class="bouton-principal" data-noter="" style="width:100%;margin-bottom:12px">${icone('add_circle')}Noter une info</button>` + (a.length ? `<div class="bloc"><ul class="fil">${a.map((x) => `
      <li><div class="date">${esc(dateFr(String(x.cree_le).slice(0, 10)))} · ${esc(x.auteur)}</div>
      <div>${icone(iconeFait(x.type), 'petite')} <b>${esc(nomFait(x.type))}</b> <span class="etiquette">${esc(x.statut === 'a_integrer' ? 'à intégrer' : x.statut)}</span></div>
      <div class="doux">${esc(x.resume)}${x.date_evenement ? ' · ' + esc(dateFr(x.date_evenement)) : ''}</div></li>`).join('')}</ul></div>`
      : `<div class="bloc"><p>Aucune info ajoutée pour l'instant.</p><p class="doux">Un vêlage, un soin, un loyer, une remarque : note-le ici, l'atelier l'intégrera ensuite.</p></div>`);
    brancher(el);
  }

  // =====================================================================
  // Connexion
  // =====================================================================
  function montrerEcran(id) {
    ['ecran-connexion', 'ecran-attente', 'ecran-appli'].forEach((e) => { $('#' + e).hidden = e !== id; });
  }
  function montrerConnexion() {
    viderCache();
    conversation.length = 0; // la discussion d'un compte ne reste pas visible après déconnexion
    montrerEcran('ecran-connexion');
    $('#bouton-connexion').disabled = false;
  }
  function montrerAppli() {
    montrerEcran('ecran-appli');
    allerOnglet('accueil');
    majBandeau();
    envoyerEnAttente();
  }
  function montrerAttente(s) {
    viderCache();
    montrerEcran('ecran-attente');
    $('#titre-attente').textContent = s.membre ? 'Bonjour ' + (s.nom || '') + ' !' : 'Compte pas encore autorisé';
    $('#texte-attente').textContent = s.membre
      ? "Ton compte est prêt. Hugo doit maintenant valider ton entrée dans l'appli : un seul geste de sa part. Ensuite, appuie sur « Vérifier »."
      : "Ce compte ne fait pas partie de la famille dans l'appli. Demande à Hugo.";
  }

  // Après connexion : membre actif → appli ; compte créé mais pas encore validé → écran d'attente.
  async function entrer() {
    let s;
    try {
      const { data, error } = await sb.rpc('famille_gerer', { p_action: 'statut', p_params: {} });
      if (error) throw error;
      s = data || {};
    } catch (e) {
      const m = String((e && e.message) || e);
      if (/Failed to fetch|NetworkError|Load failed|network/i.test(m)) { montrerAppli(); return; }
      if (/JWT|token|session/i.test(m)) { await sb.auth.signOut(); montrerConnexion(); return; }
      s = { membre: false, actif: false };
    }
    if (s.actif) montrerAppli(); else montrerAttente(s);
  }

  // Connexion normale ou première fois (chacun choisit SON mot de passe ; il part directement à Supabase)
  let modeConnexion = 'entrer';
  function reglerModeConnexion(mode) {
    modeConnexion = mode;
    const activer = mode === 'activer';
    $('#titre-connexion').textContent = activer ? 'Première fois' : 'Ferme Denis';
    $('#texte-connexion').textContent = activer ? "Tape ton e-mail, le code d'accès donné par Hugo, et choisis ton mot de passe. Tu ne le feras qu'une fois." : 'Les données de la ferme, pour la famille.';
    $('#bloc-mdp2').hidden = !activer;
    $('#bloc-code').hidden = !activer;
    $('#mdp2').required = activer;
    $('#code-acces').required = activer;
    $('#mdp').setAttribute('autocomplete', activer ? 'new-password' : 'current-password');
    $('#bouton-connexion').textContent = activer ? 'Créer mon mot de passe' : 'Entrer';
    $('#lien-mode').textContent = activer ? "J'ai déjà mon mot de passe" : 'Première fois ? Choisis ton mot de passe';
    $('#erreur-connexion').textContent = '';
  }
  $('#lien-mode').addEventListener('click', () => reglerModeConnexion(modeConnexion === 'entrer' ? 'activer' : 'entrer'));
  $$('[data-voir]').forEach((b) => b.addEventListener('click', () => {
    const champ = $('#' + b.dataset.voir);
    const visible = champ.type === 'text';
    champ.type = visible ? 'password' : 'text';
    b.innerHTML = icone(visible ? 'visibility' : 'visibility_off');
  }));

  $('#form-connexion').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const bt = $('#bouton-connexion'), err = $('#erreur-connexion');
    const email = $('#email').value.trim().toLowerCase(), mdp = $('#mdp').value;
    err.textContent = '';
    if (modeConnexion === 'activer') {
      if (mdp.length < 8) { err.textContent = 'Choisis au moins 8 caractères.'; return; }
      if (mdp !== $('#mdp2').value) { err.textContent = 'Les deux mots de passe ne sont pas pareils.'; return; }
      if ($('#code-acces').value.replace(/\D/g, '').length !== 6) { err.textContent = 'Tape le code à 6 chiffres donné par Hugo.'; return; }
    }
    bt.disabled = true; bt.textContent = modeConnexion === 'activer' ? 'Création du compte…' : 'Connexion…';
    try {
      if (modeConnexion === 'activer') {
        const r = await fetch(C.supabaseUrl + '/functions/v1/famille-activer', {
          method: 'POST', headers: { 'Content-Type': 'application/json', apikey: C.supabaseKey },
          body: JSON.stringify({ email, mot_de_passe: mdp, code: $('#code-acces').value.replace(/\D/g, '') })
        });
        let corps = {};
        try { corps = await r.json(); } catch (e) { /* réponse vide */ }
        if (!r.ok) {
          if (corps.erreur === 'existe') reglerModeConnexion('entrer');
          err.textContent = corps.texte || "Le compte n'a pas pu être créé. Réessaie.";
          return;
        }
      }
      const { error } = await sb.auth.signInWithPassword({ email, password: mdp });
      if (error) { err.textContent = /Invalid login credentials/i.test(error.message) ? 'E-mail ou mot de passe incorrect.' : messageErreur(error); return; }
      $('#mdp').value = ''; $('#mdp2').value = ''; $('#code-acces').value = '';
      reglerModeConnexion('entrer');
      await entrer();
    } catch (e) {
      err.textContent = messageErreur(e);
    } finally {
      bt.disabled = false;
      bt.textContent = modeConnexion === 'activer' ? 'Créer mon mot de passe' : 'Entrer';
    }
  });
  $('#attente-verifier').addEventListener('click', async () => {
    const b = $('#attente-verifier');
    b.disabled = true;
    try { await sb.auth.refreshSession(); } catch (e) { /* on vérifie quand même */ }
    await entrer();
    b.disabled = false;
  });
  $('#attente-sortir').addEventListener('click', async () => { await sb.auth.signOut(); montrerConnexion(); });
  // Déconnexion : on efface les données gardées sur le téléphone et les infos pas encore envoyées
  sb.auth.onAuthStateChange((evenement) => {
    if (evenement === 'SIGNED_OUT') { effacerDonneesGardees(); ecrireFile([]); horsLigneDepuis = null; majBandeau(); montrerConnexion(); }
  });

  (async function demarrer() {
    appliquerTailleTexte();
    const { data } = await sb.auth.getSession();
    if (data && data.session) entrer(); else montrerConnexion();
  })();

  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
