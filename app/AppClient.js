"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { RAW_CARDS } from "./data/seed.js";

/* ============================================================
   CONSTANTS
   ============================================================ */
const CLUB_ORDER = ["PSG", "LOSC", "PFC", "LE MANS", "MONACO"];
const CLUB_LABEL = { PSG: "PSG", LOSC: "LOSC", PFC: "Paris FC", "LE MANS": "Le Mans", MONACO: "Monaco" };
const CLUB_COLOR = {
  PSG: { bg: "#e6eef6", fg: "#1d3a5f" },
  LOSC: { bg: "#fbe7e9", fg: "#9c2733" },
  PFC: { bg: "#e6eef9", fg: "#1d3a8c" },
  "LE MANS": { bg: "#fdeede", fg: "#a3551a" },
  MONACO: { bg: "#fde9ee", fg: "#a3174a" },
};
const STATUS_DEFS = {
  stock: { label: "En stock", cls: "stock" },
  vendu: { label: "Vendu", cls: "vendu" },
  acompte: { label: "Acompte versé", cls: "acompte" },
  indispo: { label: "Non disponible", cls: "indispo" },
};

function normStatus(s) {
  if (!s) return "stock";
  s = String(s).toLowerCase().trim();
  if (s.includes("vendu")) return "vendu";
  if (s.includes("acompte")) return "acompte";
  if (s.includes("indispo") || s.includes("non dispo") || s.includes("garde") || s.includes("gardé")) return "indispo";
  return "stock";
}
function fmtMoney(v) {
  if (v === null || v === undefined || isNaN(v)) return "—";
  const n = Math.round(v * 100) / 100;
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}
function fmtMoney0(v) {
  if (v === null || v === undefined || isNaN(v)) return "—";
  return Math.round(v).toLocaleString("fr-FR") + " €";
}
function fmtDate(d) {
  if (!d || d === "?" || d === ".") return "—";
  try {
    const dt = new Date(d + "T00:00:00");
    if (isNaN(dt.getTime())) return d;
    return dt.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "2-digit" });
  } catch (e) {
    return d;
  }
}
function uid() {
  return "id_" + Math.random().toString(36).slice(2, 10);
}
function benefice(m) {
  if (m.prixVente === null || m.prixVente === undefined || m.prixVente === "") return null;
  return (parseFloat(m.prixVente) || 0) - (parseFloat(m.prixAchat) || 0);
}
function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/* ============================================================
   CARD STATS — SOURCE UNIQUE DE VÉRITÉ POUR LES CALCULS D'ABONNEMENT
   ------------------------------------------------------------
   champCount et perMatch ne sont JAMAIS stockés en dur sur la carte :
   ils sont toujours recalculés depuis card.matches, à chaque rendu.
   Coût abonnement = aboPrice + extraCard, réparti uniquement sur les
   matchs de championnat (type "champ"). Les matchs ajoutés
   manuellement (type "manual") n'entrent jamais dans ce calcul : leur
   prix d'achat est saisi librement et reste indépendant.
   ============================================================ */
function getCardStats(card) {
  const champMatches = card.matches.filter((m) => m.type === "champ");
  const champCount = champMatches.length;
  const aboTotal = (card.aboPrice || 0) + (card.extraCard || 0);
  const perMatch = champCount > 0 ? aboTotal / champCount : 0;
  return { champCount, perMatch: round2(perMatch), aboTotal: round2(aboTotal) };
}

/* Dépense réelle totale d'une carte = abonnement (réparti sur les matchs
   de championnat, donc déjà compté une fois via aboTotal) + tous les
   matchs hors-championnat dont le prix est saisi séparément (LDC, CDF,
   conférence, et matchs ajoutés manuellement). On ne fait JAMAIS
   aboTotal + somme(prixAchat de tous les matchs), car cela compterait
   les matchs "champ" deux fois (une fois dans aboTotal, une fois dans
   leur prixAchat individuel, qui n'est qu'une répartition du même
   abonnement). */
function getCardTotalSpend(card) {
  const { aboTotal } = getCardStats(card);
  const extraSpend = card.matches
    .filter((m) => m.type !== "champ")
    .reduce((s, m) => s + (parseFloat(m.prixAchat) || 0), 0);
  return round2(aboTotal + extraSpend);
}

/* Resynchronise le prixAchat de tous les matchs de championnat d'une
   carte à partir de aboPrice/extraCard/champCount courants. À appeler
   après tout ajout/suppression de match ou modification du prix de
   l'abonnement, pour que chaque ligne reste exacte. */
function resyncChampPrices(card) {
  const { perMatch } = getCardStats(card);
  card.matches.forEach((m) => {
    if (m.type === "champ") {
      m.prixAchat = perMatch;
    }
  });
}

/* Répare un state potentiellement sauvegardé avec une ancienne version
   du code (avant que getCardStats/resyncChampPrices/getCardTotalSpend
   existent). Ne touche JAMAIS aux données de vente (status, acheteur,
   prixVente, dateVente, lieuVente) : seuls les champs structurels sont
   corrigés, pour ne jamais perdre une vente déjà enregistrée. */
function migrateState(state) {
  if (!state || !Array.isArray(state.cards)) return state;
  state.cards.forEach((card) => {
    card.matches = (card.matches || []).map((m) => {
      // Type manquant ou invalide -> on le redéduit comme à la construction initiale
      const validTypes = ["champ", "ldc", "cdf", "conf", "other", "manual"];
      if (!m.type || !validTypes.includes(m.type)) {
        const isChamp = !!m.journee;
        const isLDC = /LDC/i.test(m.event || "");
        const isCDF = /CDF/i.test(m.event || "");
        const isConf = /conference/i.test(m.event || "");
        let type = isChamp ? "champ" : "other";
        if (isLDC) type = "ldc";
        else if (isCDF) type = "cdf";
        else if (isConf) type = "conf";
        if (m.manual) type = "manual";
        m.type = type;
      }
      if (m.prixAchat === undefined || m.prixAchat === null) m.prixAchat = 0;
      return m;
    });
    // Recalcule toujours le prix/match des matchs "champ" à partir de
    // aboPrice/extraCard/champCount courants : c'est la seule source
    // de vérité, jamais une valeur figée venant d'un ancien state.
    resyncChampPrices(card);
  });
  return state;
}

/* ============================================================
   BUILD INITIAL STATE
   ============================================================ */
function buildInitialState() {
  const cards = [];
  for (const sheetName in RAW_CARDS) {
    const c = RAW_CARDS[sheetName];
    const meta = c.meta;

    const matches = c.matches.map((m) => {
      const isChamp = !!m.journee;
      const isLDC = /LDC/i.test(m.event);
      const isCDF = /CDF/i.test(m.event);
      const isConf = /conference/i.test(m.event);
      let type = isChamp ? "champ" : "other";
      if (isLDC) type = "ldc";
      else if (isCDF) type = "cdf";
      else if (isConf) type = "conf";
      return {
        id: uid(),
        event: m.event,
        date: m.date,
        journee: m.journee,
        type,
        status: normStatus(m.vente_status),
        prixAchat: m.prix_achat || 0, // recalculé juste après pour les matchs "champ" via resyncChampPrices
        acheteur: m.acheteur || "",
        dateVente: m.date_vente || "",
        lieuVente: m.lieu_vente || "",
        lieuAchat: "",
        prixVente: m.prix_vente || null,
        manual: false,
      };
    });

    const card = {
      id: uid(),
      sheetName,
      club: meta.club,
      holder: (meta.holder || "").trim(),
      aboPrice: meta.abo_price || 0,
      extraCard: meta.extra_card || 0,
      matches,
    };
    resyncChampPrices(card);
    cards.push(card);
  }
  return { cards, concerts: [] };
}

/* ============================================================
   STYLES (injected once)
   ============================================================ */
const CSS = `
:root{
  --ink:#16191c; --paper:#f6f4ef; --paper-raised:#ffffff;
  --line:#dcd8cd; --line-soft:#eae7df;
  --accent:#1f5d4c; --accent-soft:#e3efe9;
  --gold:#b8893f; --gold-soft:#f6ecd9;
  --red:#a13d2c; --red-soft:#f7e7e2;
  --blue:#2c5a8c; --blue-soft:#e6eef6;
  --muted:#6b6457; --radius:10px;
  --mono:'JetBrains Mono','SF Mono',Consolas,monospace;
  --serif:'Source Serif Pro', Georgia, serif;
  --sans:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Arial,sans-serif;
}
*{box-sizing:border-box;}
body{background:var(--paper); color:var(--ink); font-family:var(--sans); font-size:14px; line-height:1.45; margin:0;}
.topbar{position:sticky; top:0; z-index:50; background:var(--ink); color:#f0ede5; padding:14px 20px; display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap;}
.brand{display:flex; align-items:baseline; gap:10px;}
.brand-mark{font-family:var(--serif); font-weight:700; font-size:19px;}
.brand-mark span{color:var(--gold);}
.season-pill{font-family:var(--mono); font-size:11px; background:#262a2d; color:#cfd6d0; padding:4px 10px; border-radius:20px;}
.savestate{font-size:11px; color:#a9a399;}
.savestate.err{color:#e2a06b;}
.reset-btn{appearance:none; border:1px solid #3a3e41; background:#262a2d; color:#cfd6d0; padding:5px 11px; border-radius:6px; font-size:11px; font-weight:600; cursor:pointer; font-family:var(--sans);}
.reset-btn:hover{border-color:var(--red); color:#f0ede5;}
.nav{position:sticky; top:53px; z-index:49; background:var(--paper-raised); border-bottom:1px solid var(--line); display:flex; overflow-x:auto; padding:0 12px;}
.nav-btn{appearance:none; border:none; background:none; cursor:pointer; padding:13px 16px; font-size:13px; font-weight:600; color:var(--muted); white-space:nowrap; border-bottom:2px solid transparent; font-family:var(--sans);}
.nav-btn:hover{color:var(--ink);}
.nav-btn.active{color:var(--accent); border-bottom-color:var(--accent);}
.view{padding:22px 20px 60px; max-width:1320px; margin:0 auto;}
.view-head{display:flex; align-items:flex-end; justify-content:space-between; gap:16px; margin-bottom:18px; flex-wrap:wrap;}
.view-title{font-family:var(--serif); font-size:24px; font-weight:700; margin:0;}
.view-desc{color:var(--muted); font-size:13px; margin-top:4px;}
.kpi-row{display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:10px; margin-bottom:20px;}
.kpi{background:var(--paper-raised); border:1px solid var(--line); border-radius:var(--radius); padding:13px 15px;}
.kpi-label{font-size:10.5px; text-transform:uppercase; letter-spacing:0.5px; color:var(--muted); margin-bottom:6px; font-weight:600;}
.kpi-value{font-family:var(--mono); font-size:21px; font-weight:700;}
.kpi-value.pos{color:var(--accent);} .kpi-value.neg{color:var(--red);}
.kpi-sub{font-size:11px; color:var(--muted); margin-top:2px;}
.card-grid{display:grid; grid-template-columns:repeat(auto-fill,minmax(230px,1fr)); gap:12px; margin-bottom:24px;}
.club-card{background:var(--paper-raised); border:1px solid var(--line); border-radius:var(--radius); padding:16px; cursor:pointer; transition:border-color .15s, transform .1s;}
.club-card:hover{border-color:var(--accent); transform:translateY(-1px);}
.club-card.selected{border-color:var(--accent); box-shadow:0 0 0 1px var(--accent);}
.club-tag{font-family:var(--mono); font-size:10px; text-transform:uppercase; letter-spacing:0.6px; color:var(--muted); margin-bottom:4px;}
.club-name{font-family:var(--serif); font-size:17px; font-weight:700; margin-bottom:8px;}
.club-stats{display:flex; gap:14px; font-size:11.5px; color:var(--muted); flex-wrap:wrap;}
.club-stats b{color:var(--ink); font-family:var(--mono);}
.table-wrap{background:var(--paper-raised); border:1px solid var(--line); border-radius:var(--radius); overflow:hidden; overflow-x:auto;}
table{width:100%; border-collapse:collapse; font-size:12.8px;}
thead th{text-align:left; padding:9px 11px; background:#efece4; color:var(--muted); font-weight:600; text-transform:uppercase; font-size:10.5px; letter-spacing:0.4px; border-bottom:1px solid var(--line); white-space:nowrap;}
tbody td{padding:8px 11px; border-bottom:1px solid var(--line-soft); vertical-align:middle;}
tbody tr:last-child td{border-bottom:none;}
tbody tr:hover{background:#faf9f5;}
.cell-num{font-family:var(--mono); text-align:right; white-space:nowrap;}
.cell-date{font-family:var(--mono); color:var(--muted); white-space:nowrap;}
.cell-event{font-weight:600;}
.badge{display:inline-flex; align-items:center; gap:5px; padding:3px 9px; border-radius:20px; font-size:11px; font-weight:600; white-space:nowrap;}
.badge-dot{width:6px; height:6px; border-radius:50%;}
.badge.stock{background:var(--blue-soft); color:var(--blue);} .badge.stock .badge-dot{background:var(--blue);}
.badge.vendu{background:var(--accent-soft); color:var(--accent);} .badge.vendu .badge-dot{background:var(--accent);}
.badge.acompte{background:var(--gold-soft); color:var(--gold);} .badge.acompte .badge-dot{background:var(--gold);}
.badge.indispo{background:#ece9e2; color:var(--muted);} .badge.indispo .badge-dot{background:var(--muted);}
.badge.manual{background:#eee7f7; color:#5b3a99;}
.benefice-pos{color:var(--accent); font-weight:700;} .benefice-neg{color:var(--red); font-weight:700;} .benefice-zero{color:var(--muted);}
.btn{appearance:none; border:1px solid var(--line); background:var(--paper-raised); color:var(--ink); padding:8px 14px; border-radius:7px; font-size:12.5px; font-weight:600; cursor:pointer; font-family:var(--sans);}
.btn:hover{border-color:var(--accent); color:var(--accent);}
.btn-primary{background:var(--accent); border-color:var(--accent); color:#fff;}
.btn-primary:hover{background:#194a3d; color:#fff;}
.btn-sm{padding:5px 10px; font-size:11.5px;}
.btn-sell{background:var(--gold); border-color:var(--gold); color:#fff; padding:5px 12px; font-size:11.5px; border-radius:6px; font-weight:700;}
.btn-sell:hover{background:#9c722f;}
.btn-undo{background:none; border:1px solid var(--line); color:var(--muted); padding:5px 10px; font-size:11px; border-radius:6px;}
.btn-undo:hover{border-color:var(--red); color:var(--red);}
.icon-btn{appearance:none; border:none; background:none; cursor:pointer; color:var(--muted); padding:4px 6px; border-radius:5px; font-size:14px;}
.icon-btn:hover{background:var(--red-soft); color:var(--red);}
.section{background:var(--paper-raised); border:1px solid var(--line); border-radius:var(--radius); padding:18px; margin-bottom:18px;}
.section-title{font-family:var(--serif); font-size:16px; font-weight:700; margin:0 0 12px; display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;}
.form-grid{display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:10px; margin-bottom:12px;}
.form-field label{display:block; font-size:10.5px; text-transform:uppercase; letter-spacing:0.4px; color:var(--muted); margin-bottom:4px; font-weight:600;}
.form-field input, .form-field select{width:100%; border:1px solid var(--line); border-radius:7px; padding:8px 10px; font-size:13px; font-family:inherit; background:var(--paper);}
.form-field input:focus, .form-field select:focus{outline:none; border-color:var(--accent); background:#fff;}
.inline-input{width:100%; border:1px solid transparent; background:transparent; font-family:inherit; font-size:12.8px; padding:4px 6px; border-radius:5px; color:var(--ink);}
.inline-input:hover{border-color:var(--line);}
.inline-input:focus{outline:none; border-color:var(--accent); background:#fff; box-shadow:0 0 0 2px var(--accent-soft);}
.empty{padding:40px 20px; text-align:center; color:var(--muted);}
.empty-title{font-family:var(--serif); font-size:16px; color:var(--ink); margin-bottom:4px;}
.recap-grid{display:grid; grid-template-columns:1fr 1fr; gap:16px;}
.recap-row{display:flex; justify-content:space-between; align-items:center; padding:9px 0; border-bottom:1px solid var(--line-soft); font-size:13px;}
.recap-row:last-child{border-bottom:none;}
.recap-row .label{color:var(--ink); font-weight:600;}
.recap-row .sub{color:var(--muted); font-size:11.5px; display:block; margin-top:1px; font-weight:400;}
.recap-row .val{font-family:var(--mono); font-weight:700; font-size:13.5px;}
.tag-club{display:inline-block; font-family:var(--mono); font-size:10px; padding:2px 7px; border-radius:4px; text-transform:uppercase; letter-spacing:0.3px; font-weight:700;}
.modal-overlay{position:fixed; inset:0; background:rgba(22,25,28,0.55); display:flex; align-items:center; justify-content:center; z-index:100; padding:16px;}
.modal{background:var(--paper-raised); border-radius:12px; padding:24px; width:100%; max-width:380px; box-shadow:0 20px 60px rgba(0,0,0,0.3);}
.modal h3{font-family:var(--serif); font-size:18px; margin:0 0 4px;}
.modal .sub{color:var(--muted); font-size:12.5px; margin-bottom:18px;}
.modal-field{margin-bottom:14px;}
.modal-field label{display:block; font-size:11px; text-transform:uppercase; letter-spacing:0.4px; color:var(--muted); margin-bottom:5px; font-weight:600;}
.modal-field input{width:100%; border:1px solid var(--line); border-radius:8px; padding:10px 12px; font-size:14px; font-family:inherit;}
.modal-field input:focus{outline:none; border-color:var(--accent);}
.modal-actions{display:flex; gap:8px; margin-top:18px;}
.modal-actions .btn{flex:1; text-align:center;}
.modal-benef{font-family:var(--mono); font-weight:700; font-size:15px; padding:10px 12px; background:var(--accent-soft); color:var(--accent); border-radius:8px; margin-bottom:14px;}
.modal-benef.neg{background:var(--red-soft); color:var(--red);}
.client-card{background:var(--paper-raised); border:1px solid var(--line); border-radius:var(--radius); padding:16px; margin-bottom:12px;}
.client-head{display:flex; align-items:baseline; justify-content:space-between; gap:10px; margin-bottom:10px; flex-wrap:wrap;}
.client-name{font-family:var(--serif); font-size:16px; font-weight:700;}
.client-meta{font-size:11.5px; color:var(--muted);}
@media (max-width:800px){.recap-grid{grid-template-columns:1fr;}}
@media (max-width:640px){.view{padding:16px 12px 50px;} thead th, tbody td{padding:7px 8px;} .view-title{font-size:20px;}}
.footer-note{text-align:center; color:var(--muted); font-size:11px; padding:30px 0 10px;}
`;

/* ============================================================
   SELL MODAL
   ============================================================ */
function SellModal({ match, onClose, onConfirm }) {
  const [prix, setPrix] = useState(match.prixVente ?? "");
  const [acheteur, setAcheteur] = useState(match.acheteur ?? "");
  const [lieu, setLieu] = useState(match.lieuVente ?? "");
  const b = prix !== "" && prix !== null ? parseFloat(prix) - (parseFloat(match.prixAchat) || 0) : null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Vendre ce billet</h3>
        <div className="sub">
          {match.event} {match.date ? "· " + fmtDate(match.date) : ""} — coût {fmtMoney(match.prixAchat)}
        </div>
        <div className="modal-field">
          <label>Prix de vente</label>
          <input
            type="number"
            step="0.01"
            autoFocus
            value={prix}
            onChange={(e) => setPrix(e.target.value)}
            placeholder="0,00"
          />
        </div>
        <div className="modal-field">
          <label>Acheteur</label>
          <input value={acheteur} onChange={(e) => setAcheteur(e.target.value)} placeholder="Nom de l'acheteur" />
        </div>
        <div className="modal-field">
          <label>Lieu / plateforme de vente</label>
          <input value={lieu} onChange={(e) => setLieu(e.target.value)} placeholder="Vinted, main propre, etc." />
        </div>
        {b !== null && !isNaN(b) && (
          <div className={"modal-benef" + (b < 0 ? " neg" : "")}>
            Bénéfice : {fmtMoney(b)}
          </div>
        )}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Annuler
          </button>
          <button
            className="btn btn-primary"
            disabled={prix === "" || prix === null}
            onClick={() => onConfirm({ prixVente: prix === "" ? null : parseFloat(prix), acheteur, lieuVente: lieu })}
          >
            Confirmer la vente
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   ADD MATCH MODAL — nom + date + prix d'achat libres
   ============================================================ */
function AddMatchModal({ card, onClose, onConfirm }) {
  const [event, setEvent] = useState("");
  const [date, setDate] = useState("");
  const [prixAchat, setPrixAchat] = useState("");

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Ajouter un match</h3>
        <div className="sub">
          {CLUB_LABEL[card.club] || card.club} — {card.holder}
        </div>
        <div className="modal-field">
          <label>Nom du match</label>
          <input autoFocus value={event} onChange={(e) => setEvent(e.target.value)} placeholder="Ex: Paris vs Marseille" />
        </div>
        <div className="modal-field">
          <label>Date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="modal-field">
          <label>Prix d'achat</label>
          <input type="number" step="0.01" value={prixAchat} onChange={(e) => setPrixAchat(e.target.value)} placeholder="0,00" />
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Annuler
          </button>
          <button
            className="btn btn-primary"
            disabled={!event.trim()}
            onClick={() =>
              onConfirm({
                event: event.trim(),
                date: date || null,
                prixAchat: prixAchat === "" ? 0 : parseFloat(prixAchat) || 0,
              })
            }
          >
            Ajouter
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   STATUS BADGE / SELECT
   ============================================================ */
function StatusBadge({ status }) {
  const d = STATUS_DEFS[status] || STATUS_DEFS.stock;
  return (
    <span className={"badge " + d.cls}>
      <span className="badge-dot"></span>
      {d.label}
    </span>
  );
}

/* ============================================================
   MATCH TABLE ROW — used everywhere (Le Mans / per-club view / revente)
   ============================================================ */
function MatchRow({ card, m, onUpdate, onSell, onUndo, onDelete, showClubCol, showHolderCol }) {
  const b = benefice(m);
  const bClass = b === null ? "benefice-zero" : b >= 0 ? "benefice-pos" : "benefice-neg";
  const col = CLUB_COLOR[card.club] || { bg: "#eee", fg: "#333" };

  return (
    <tr>
      {showClubCol && (
        <td>
          <span className="tag-club" style={{ background: col.bg, color: col.fg }}>
            {CLUB_LABEL[card.club] || card.club}
          </span>
        </td>
      )}
      {showHolderCol && <td>{card.holder}</td>}
      <td>
        {m.journee
          ? m.journee
          : m.type === "ldc"
          ? "LDC"
          : m.type === "cdf"
          ? "CDF"
          : m.type === "conf"
          ? "Conf."
          : m.manual
          ? "Ajouté"
          : "—"}
      </td>
      <td className="cell-event">{m.event}</td>
      <td className="cell-date">{fmtDate(m.date)}</td>
      <td className="cell-num">{fmtMoney(m.prixAchat)}</td>
      <td>
        <StatusBadge status={m.status} />
      </td>
      <td>{m.acheteur || "—"}</td>
      <td>{m.lieuVente || "—"}</td>
      <td className="cell-num">{m.prixVente !== null && m.prixVente !== undefined ? fmtMoney(m.prixVente) : "—"}</td>
      <td className={"cell-num " + bClass}>{b === null ? "—" : fmtMoney(b)}</td>
      <td style={{ whiteSpace: "nowrap" }}>
        {m.status === "vendu" ? (
          <button className="btn-undo" onClick={() => onUndo(card.id, m.id)}>
            Annuler vente
          </button>
        ) : (
          <button className="btn-sell" onClick={() => onSell(card.id, m.id)}>
            Vendre
          </button>
        )}
        {m.manual && onDelete && (
          <button className="icon-btn" title="Supprimer ce match" onClick={() => onDelete(card.id, m.id)}>
            ✕
          </button>
        )}
      </td>
    </tr>
  );
}

/* ============================================================
   MAIN APP
   ============================================================ */
export default function App() {
  const [state, setState] = useState(null);
  const [view, setView] = useState("dashboard");
  const [saveStatus, setSaveStatus] = useState("idle"); // idle | saving | saved | error
  const [selectedCardId, setSelectedCardId] = useState(null);
  const [sellTarget, setSellTarget] = useState(null); // {cardId, matchId}
  const [addMatchTarget, setAddMatchTarget] = useState(null); // cardId
  const etagRef = useRef(null);
  const saveTimer = useRef(null);
  const initialized = useRef(false);

  const [needsResave, setNeedsResave] = useState(false);

  /* ---------- load ---------- */
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/state", { cache: "no-store" });
        const data = await res.json();
        if (data.state) {
          const before = JSON.stringify(data.state);
          const migrated = migrateState(data.state);
          const after = JSON.stringify(migrated);
          setState(migrated);
          etagRef.current = data.etag;
          // Si la migration a changé quelque chose (ancien format détecté),
          // on force une ré-écriture immédiate du fichier serveur pour que
          // la correction soit définitive et ne se reproduise plus.
          if (before !== after) setNeedsResave(true);
        } else {
          const init = buildInitialState();
          setState(init);
          etagRef.current = null;
        }
      } catch (e) {
        setState(buildInitialState());
      }
      initialized.current = true;
    })();
  }, []);

  /* ---------- save (debounced) ---------- */
  const persist = useCallback((nextState) => {
    clearTimeout(saveTimer.current);
    setSaveStatus("saving");
    saveTimer.current = setTimeout(async () => {
      try {
        const res = await fetch("/api/state", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state: nextState, etag: etagRef.current }),
        });
        const data = await res.json();
        if (data.error === "conflict") {
          // reload latest then retry once
          const fresh = await fetch("/api/state", { cache: "no-store" }).then((r) => r.json());
          etagRef.current = fresh.etag;
          const retry = await fetch("/api/state", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ state: nextState, etag: fresh.etag }),
          }).then((r) => r.json());
          if (retry.ok) {
            etagRef.current = retry.etag;
            setSaveStatus("saved");
          } else {
            setSaveStatus("error");
          }
          return;
        }
        if (data.ok) {
          etagRef.current = data.etag;
          setSaveStatus("saved");
        } else {
          setSaveStatus("error");
        }
      } catch (e) {
        setSaveStatus("error");
      }
    }, 400);
  }, []);

  const updateState = useCallback(
    (mutator) => {
      setState((prev) => {
        const next = structuredClone(prev);
        mutator(next);
        persist(next);
        return next;
      });
    },
    [persist]
  );

  /* Sauvegarde immédiate après une migration de données (ancien format
     détecté au chargement), pour corriger le fichier serveur une bonne
     fois pour toutes. */
  useEffect(() => {
    if (needsResave && state) {
      persist(state);
      setNeedsResave(false);
    }
  }, [needsResave, state, persist]);

  /* ---------- generic match field update ---------- */
  const updateMatchField = (cardId, matchId, field, value) => {
    updateState((s) => {
      const card = s.cards.find((c) => c.id === cardId);
      const m = card.matches.find((x) => x.id === matchId);
      m[field] = value;
    });
  };

  const handleSell = (cardId, matchId) => setSellTarget({ cardId, matchId });

  const confirmSell = ({ prixVente, acheteur, lieuVente }) => {
    updateState((s) => {
      const card = s.cards.find((c) => c.id === sellTarget.cardId);
      const m = card.matches.find((x) => x.id === sellTarget.matchId);
      m.prixVente = prixVente;
      m.acheteur = acheteur;
      m.lieuVente = lieuVente;
      m.status = "vendu";
      if (!m.dateVente) m.dateVente = new Date().toISOString().slice(0, 10);
    });
    setSellTarget(null);
  };

  const handleUndo = (cardId, matchId) => {
    updateState((s) => {
      const card = s.cards.find((c) => c.id === cardId);
      const m = card.matches.find((x) => x.id === matchId);
      m.status = "stock";
      m.prixVente = null;
      m.acheteur = "";
      m.lieuVente = "";
      m.dateVente = "";
    });
  };

  const handleAddMatch = (cardId) => setAddMatchTarget(cardId);

  const confirmAddMatch = ({ event, date, prixAchat }) => {
    updateState((s) => {
      const card = s.cards.find((c) => c.id === addMatchTarget);
      card.matches.push({
        id: uid(),
        event,
        date,
        journee: null,
        type: "manual",
        status: "stock",
        prixAchat,
        acheteur: "",
        dateVente: "",
        lieuVente: "",
        lieuAchat: "",
        prixVente: null,
        manual: true,
      });
      resyncChampPrices(card);
    });
    setAddMatchTarget(null);
  };

  const handleDeleteMatch = (cardId, matchId) => {
    updateState((s) => {
      const card = s.cards.find((c) => c.id === cardId);
      card.matches = card.matches.filter((m) => m.id !== matchId);
      resyncChampPrices(card);
    });
  };

  const handleResetAll = () => {
    if (!window.confirm("Réinitialiser toutes les données ? Toutes les ventes, acheteurs et matchs ajoutés seront définitivement perdus, et on repart du calendrier de base.")) {
      return;
    }
    const init = buildInitialState();
    setState(init);
    persist(init);
  };

  if (!state) {
    return (
      <div style={{ padding: 40, fontFamily: "sans-serif", color: "#6b6457" }}>Chargement…</div>
    );
  }

  const sellMatch = sellTarget
    ? state.cards.find((c) => c.id === sellTarget.cardId)?.matches.find((m) => m.id === sellTarget.matchId)
    : null;

  const addMatchCard = addMatchTarget ? state.cards.find((c) => c.id === addMatchTarget) : null;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="topbar">
        <div className="brand">
          <div className="brand-mark">
            Stade<span>&</span>Tribune
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className={"savestate" + (saveStatus === "error" ? " err" : "")}>
            {saveStatus === "saving" && "Enregistrement…"}
            {saveStatus === "saved" && "Enregistré"}
            {saveStatus === "error" && "Erreur de sauvegarde"}
            {saveStatus === "idle" && ""}
          </span>
          <button className="reset-btn" onClick={handleResetAll} title="Effacer toutes les données et repartir du calendrier de base">
            Réinitialiser
          </button>
          <span className="season-pill">Saison 2026 – 2027</span>
        </div>
      </div>

      <div className="nav">
        {[
          ["dashboard", "Tableau de bord"],
          ["clubs", "Mes abonnements"],
          ["emplacements", "Emplacements clubs"],
          ["revente", "Revente billets"],
          ["memberships", "Memberships"],
          ["concerts", "Concerts"],
          ["clients", "Base clients"],
          ["recap", "Récap général"],
        ].map(([key, label]) => (
          <button
            key={key}
            className={"nav-btn" + (view === key ? " active" : "")}
            onClick={() => setView(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {view === "dashboard" && <DashboardView state={state} goToClub={(id) => { setSelectedCardId(id); setView("clubs"); }} />}
      {view === "clubs" && (
        <ClubsView
          state={state}
          selectedCardId={selectedCardId}
          setSelectedCardId={setSelectedCardId}
          onSell={handleSell}
          onUndo={handleUndo}
          onAddMatch={handleAddMatch}
          onDeleteMatch={handleDeleteMatch}
          updateMatchField={updateMatchField}
        />
      )}
      {view === "emplacements" && <EmplacementsView state={state} />}
      {view === "revente" && (
        <ReventeView
          state={state}
          onSell={handleSell}
          onUndo={handleUndo}
          onDeleteMatch={handleDeleteMatch}
          updateMatchField={updateMatchField}
        />
      )}
      {view === "memberships" && <MembershipsView state={state} />}
      {view === "concerts" && <ConcertsView state={state} updateState={updateState} />}
      {view === "clients" && <ClientsView state={state} />}
      {view === "recap" && <RecapView state={state} />}

      {sellMatch && (
        <SellModal match={sellMatch} onClose={() => setSellTarget(null)} onConfirm={confirmSell} />
      )}

      {addMatchCard && (
        <AddMatchModal card={addMatchCard} onClose={() => setAddMatchTarget(null)} onConfirm={confirmAddMatch} />
      )}

      <div className="footer-note">
        Toutes les données sont enregistrées automatiquement et partagées entre tes appareils.
      </div>
    </>
  );
}

/* ============================================================
   DASHBOARD
   ============================================================ */
function DashboardView({ state, goToClub }) {
  const cards = state.cards;
  let totalAbo = 0,
    totalSpendReal = 0,
    totalVendu = 0,
    totalBenef = 0,
    nbBillets = 0,
    nbVendus = 0;
  cards.forEach((c) => {
    totalAbo += c.aboPrice + c.extraCard;
    totalSpendReal += getCardTotalSpend(c);
    c.matches.forEach((m) => {
      nbBillets++;
      if (m.status === "vendu") nbVendus++;
      const b = benefice(m);
      if (b !== null) totalBenef += b;
      if (m.prixVente) totalVendu += parseFloat(m.prixVente) || 0;
    });
  });
  let concertProfit = state.concerts.reduce((s, c) => {
    if (c.status !== "vendu") return s;
    return s + ((parseFloat(c.prixVente) || 0) - (parseFloat(c.prixAchat) || 0));
  }, 0);

  const today = new Date().toISOString().slice(0, 10);
  let upcoming = [];
  cards.forEach((c) => {
    c.matches.forEach((m) => {
      if (m.date && m.date !== "?" && m.date !== "." && m.date >= today) {
        upcoming.push({ ...m, club: c.club, holder: c.holder, cardId: c.id });
      }
    });
  });
  upcoming.sort((a, b) => a.date.localeCompare(b.date));
  upcoming = upcoming.slice(0, 12);

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <h1 className="view-title">Tableau de bord</h1>
          <div className="view-desc">Vue d'ensemble de tous tes abonnements foot et de ta billetterie concerts.</div>
        </div>
      </div>
      <div className="kpi-row">
        <div className="kpi">
          <div className="kpi-label">Total abonnements foot</div>
          <div className="kpi-value">{fmtMoney0(totalAbo)}</div>
          <div className="kpi-sub">{cards.length} cartes actives</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Dépense réelle totale</div>
          <div className="kpi-value">{fmtMoney0(totalSpendReal)}</div>
          <div className="kpi-sub">abonnements + LDC/CDF/matchs ajoutés</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Billets foot vendus</div>
          <div className="kpi-value pos">
            {nbVendus} / {nbBillets}
          </div>
          <div className="kpi-sub">{fmtMoney0(totalVendu)} de revenus</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Bénéfice foot</div>
          <div className={"kpi-value " + (totalBenef >= 0 ? "pos" : "neg")}>{fmtMoney0(totalBenef)}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Billets concerts</div>
          <div className="kpi-value">{state.concerts.length}</div>
          <div className="kpi-sub">{fmtMoney0(concertProfit)} de bénéfice</div>
        </div>
      </div>

      <div className="section">
        <div className="section-title">Toutes les cartes d'abonnement</div>
        <div className="card-grid">
          {cards.map((c) => {
            const sold = c.matches.filter((m) => m.status === "vendu").length;
            const stock = c.matches.filter((m) => m.status === "stock").length;
            const col = CLUB_COLOR[c.club] || { bg: "#eee", fg: "#333" };
            const { perMatch } = getCardStats(c);
            return (
              <div className="club-card" key={c.id} onClick={() => goToClub(c.id)}>
                <div className="club-tag">{CLUB_LABEL[c.club] || c.club}</div>
                <div className="club-name">{c.holder || "—"}</div>
                <div className="club-stats">
                  <span>
                    Abo <b>{fmtMoney0(c.aboPrice + c.extraCard)}</b>
                  </span>
                  <span>
                    /match <b>{fmtMoney(perMatch)}</b>
                  </span>
                </div>
                <div className="club-stats" style={{ marginTop: 6 }}>
                  <span>
                    En stock <b>{stock}</b>
                  </span>
                  <span>
                    Vendus <b>{sold}</b>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="section">
        <div className="section-title">Prochains matchs à domicile (toutes cartes)</div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Club</th>
                <th>Carte</th>
                <th>Match</th>
                <th>Journée</th>
                <th>Statut billet</th>
              </tr>
            </thead>
            <tbody>
              {upcoming.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>
                    Aucun match à venir trouvé
                  </td>
                </tr>
              ) : (
                upcoming.map((m) => {
                  const col = CLUB_COLOR[m.club] || { bg: "#eee", fg: "#333" };
                  return (
                    <tr key={m.id} style={{ cursor: "pointer" }} onClick={() => goToClub(m.cardId)}>
                      <td className="cell-date">{fmtDate(m.date)}</td>
                      <td>
                        <span className="tag-club" style={{ background: col.bg, color: col.fg }}>
                          {CLUB_LABEL[m.club] || m.club}
                        </span>
                      </td>
                      <td>{m.holder}</td>
                      <td className="cell-event">{m.event}</td>
                      <td>{m.journee || "—"}</td>
                      <td>
                        <StatusBadge status={m.status} />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   CLUBS VIEW — generalized "Le Mans-style" calendar for EVERY card
   ============================================================ */
function ClubsView({ state, selectedCardId, setSelectedCardId, onSell, onUndo, onAddMatch, onDeleteMatch, updateMatchField }) {
  const cards = state.cards;
  const activeId = selectedCardId && cards.find((c) => c.id === selectedCardId) ? selectedCardId : cards[0]?.id;
  const card = cards.find((c) => c.id === activeId);

  if (!card) return null;

  const sold = card.matches.filter((m) => m.status === "vendu");
  const totalBenef = sold.reduce((s, m) => s + (benefice(m) || 0), 0);
  const col = CLUB_COLOR[card.club] || { bg: "#eee", fg: "#333" };
  const { champCount, perMatch } = getCardStats(card);
  const totalSpend = getCardTotalSpend(card);

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <h1 className="view-title">Mes abonnements — calendrier par carte</h1>
          <div className="view-desc">Prix par match = abonnement annuel ÷ nombre de matchs de championnat à domicile.</div>
        </div>
      </div>

      <div className="card-grid" style={{ marginBottom: 18 }}>
        {cards.map((c) => {
          const ccol = CLUB_COLOR[c.club] || { bg: "#eee", fg: "#333" };
          const { perMatch: cPerMatch } = getCardStats(c);
          const cTotalSpend = getCardTotalSpend(c);
          return (
            <div
              key={c.id}
              className={"club-card" + (c.id === activeId ? " selected" : "")}
              onClick={() => setSelectedCardId(c.id)}
            >
              <div className="club-tag" style={{ color: ccol.fg }}>
                {CLUB_LABEL[c.club] || c.club}
              </div>
              <div className="club-name">{c.holder}</div>
              <div className="club-stats">
                <span>
                  Dépense totale <b>{fmtMoney0(cTotalSpend)}</b>
                </span>
                <span>
                  /match <b>{fmtMoney(cPerMatch)}</b>
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="kpi-row">
        <div className="kpi">
          <div className="kpi-label">Abonnement (membership)</div>
          <div className="kpi-value">{fmtMoney0(card.aboPrice + card.extraCard)}</div>
          <div className="kpi-sub">prix fixe payé au club, ne change pas</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Dépense totale carte</div>
          <div className="kpi-value">{fmtMoney0(totalSpend)}</div>
          <div className="kpi-sub">+ Supercoupe / LDC / CDF / matchs ajoutés</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Matchs championnat dom.</div>
          <div className="kpi-value">{champCount}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Prix par match</div>
          <div className="kpi-value">{fmtMoney(perMatch)}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Bénéfice revente</div>
          <div className={"kpi-value " + (totalBenef >= 0 ? "pos" : "neg")}>{fmtMoney0(totalBenef)}</div>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Journée</th>
              <th>Match</th>
              <th>Date</th>
              <th>Prix / match</th>
              <th>Statut</th>
              <th>Acheteur</th>
              <th>Lieu vente</th>
              <th>Prix vente</th>
              <th>Bénéfice</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {card.matches.map((m) => (
              <MatchRow
                key={m.id}
                card={card}
                m={m}
                onSell={onSell}
                onUndo={onUndo}
                onDelete={onDeleteMatch}
                updateMatchField={updateMatchField}
                showClubCol={false}
                showHolderCol={false}
              />
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 14 }}>
        <button className="btn btn-primary" onClick={() => onAddMatch(card.id)}>
          + Ajouter un match pour cette carte
        </button>
      </div>
    </div>
  );
}

/* ============================================================
   EMPLACEMENTS VIEW
   ============================================================ */
function EmplacementsView({ state }) {
  const byClub = {};
  state.cards.forEach((c) => {
    if (!byClub[c.club]) byClub[c.club] = [];
    byClub[c.club].push(c);
  });

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <h1 className="view-title">Emplacements & cartes par club</h1>
          <div className="view-desc">
            Paris FC ×2, PSG ×4, LOSC ×2 (+ 2 emplacements LDC), Monaco ×1 — coût de chaque abonnement.
          </div>
        </div>
      </div>
      {CLUB_ORDER.map((club) => {
        const cards = byClub[club];
        if (!cards) return null;
        const totalAbo = cards.reduce((s, c) => s + getCardTotalSpend(c), 0);
        const col = CLUB_COLOR[club] || { bg: "#eee", fg: "#333" };
        return (
          <div className="section" key={club}>
            <div className="section-title">
              <span className="tag-club" style={{ background: col.bg, color: col.fg }}>
                {CLUB_LABEL[club]}
              </span>
              &nbsp; {cards.length} emplacement{cards.length > 1 ? "s" : ""} — total {fmtMoney0(totalAbo)}
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Titulaire</th>
                    <th>Type</th>
                    <th>Abonnement</th>
                    <th>Frais carte</th>
                    <th>Dépense totale</th>
                    <th>Matchs champ.</th>
                    <th>Prix / match</th>
                  </tr>
                </thead>
                <tbody>
                  {cards.map((c) => {
                    const { champCount: cChampCount, perMatch: cPerMatch } = getCardStats(c);
                    const cTotalSpend = getCardTotalSpend(c);
                    return (
                      <tr key={c.id}>
                        <td className="cell-event">{c.holder}</td>
                        <td>{c.matches.some((m) => m.type === "ldc") ? "Abonnement + Pack LDC" : "Abonnement"}</td>
                        <td className="cell-num">{fmtMoney(c.aboPrice)}</td>
                        <td className="cell-num">{c.extraCard ? fmtMoney(c.extraCard) : "—"}</td>
                        <td className="cell-num" style={{ fontWeight: 700 }}>
                          {fmtMoney(cTotalSpend)}
                        </td>
                        <td className="cell-num">{cChampCount}</td>
                        <td className="cell-num">{fmtMoney(cPerMatch)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ============================================================
   REVENTE VIEW
   ============================================================ */
function ReventeView({ state, onSell, onUndo, onDeleteMatch, updateMatchField }) {
  const [clubFilter, setClubFilter] = useState("");
  const [cardFilter, setCardFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const clubs = [...new Set(state.cards.map((c) => c.club))];

  let rows = [];
  state.cards.forEach((c) => {
    if (clubFilter && c.club !== clubFilter) return;
    if (cardFilter && c.id !== cardFilter) return;
    c.matches.forEach((m) => {
      if (statusFilter && m.status !== statusFilter) return;
      rows.push({ card: c, m });
    });
  });

  let totalVente = 0,
    totalBenef = 0,
    nbVendu = 0;
  state.cards.forEach((c) =>
    c.matches.forEach((m) => {
      if (m.status === "vendu") {
        nbVendu++;
        totalVente += parseFloat(m.prixVente) || 0;
        totalBenef += benefice(m) || 0;
      }
    })
  );

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <h1 className="view-title">Revente — suivi match par match</h1>
          <div className="view-desc">Coût, acheteur et bénéfice pour chaque billet. Clique "Vendre" pour enregistrer une vente en un clic.</div>
        </div>
      </div>
      <div className="kpi-row">
        <div className="kpi">
          <div className="kpi-label">Billets affichés</div>
          <div className="kpi-value">{rows.length}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Total vendus</div>
          <div className="kpi-value">{nbVendu}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Revenus de revente</div>
          <div className="kpi-value pos">{fmtMoney0(totalVente)}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Bénéfice net</div>
          <div className={"kpi-value " + (totalBenef >= 0 ? "pos" : "neg")}>{fmtMoney0(totalBenef)}</div>
        </div>
      </div>

      <div className="section" style={{ marginBottom: 14 }}>
        <div className="form-grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))" }}>
          <div className="form-field">
            <label>Club</label>
            <select value={clubFilter} onChange={(e) => setClubFilter(e.target.value)}>
              <option value="">Tous</option>
              {clubs.map((c) => (
                <option key={c} value={c}>
                  {CLUB_LABEL[c] || c}
                </option>
              ))}
            </select>
          </div>
          <div className="form-field">
            <label>Carte</label>
            <select value={cardFilter} onChange={(e) => setCardFilter(e.target.value)}>
              <option value="">Toutes</option>
              {state.cards.map((c) => (
                <option key={c.id} value={c.id}>
                  {CLUB_LABEL[c.club]} — {c.holder}
                </option>
              ))}
            </select>
          </div>
          <div className="form-field">
            <label>Statut</label>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">Tous</option>
              {Object.entries(STATUS_DEFS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Club</th>
              <th>Carte</th>
              <th>Journée</th>
              <th>Match</th>
              <th>Date</th>
              <th>Prix achat</th>
              <th>Statut</th>
              <th>Acheteur</th>
              <th>Lieu vente</th>
              <th>Prix vente</th>
              <th>Bénéfice</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={12} style={{ textAlign: "center", padding: 24, color: "var(--muted)" }}>
                  Aucun billet ne correspond aux filtres
                </td>
              </tr>
            ) : (
              rows.map(({ card, m }) => (
                <MatchRow
                  key={m.id}
                  card={card}
                  m={m}
                  onSell={onSell}
                  onUndo={onUndo}
                  onDelete={onDeleteMatch}
                  updateMatchField={updateMatchField}
                  showClubCol={true}
                  showHolderCol={true}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ============================================================
   MEMBERSHIPS VIEW
   ============================================================ */
function MembershipsView({ state }) {
  const cards = state.cards;
  const totalCost = cards.reduce((s, c) => s + c.aboPrice + c.extraCard, 0);
  const totalSpendAll = cards.reduce((s, c) => s + getCardTotalSpend(c), 0);
  return (
    <div className="view">
      <div className="view-head">
        <div>
          <h1 className="view-title">Memberships</h1>
          <div className="view-desc">Toutes les cartes d'abonnement et leur coût annuel.</div>
        </div>
      </div>
      <div className="kpi-row">
        <div className="kpi">
          <div className="kpi-label">Nombre de cartes</div>
          <div className="kpi-value">{cards.length}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Coût total memberships</div>
          <div className="kpi-value">{fmtMoney0(totalCost)}</div>
          <div className="kpi-sub">abonnements seuls</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Dépense totale réelle</div>
          <div className="kpi-value">{fmtMoney0(totalSpendAll)}</div>
          <div className="kpi-sub">+ Supercoupe / LDC / CDF / matchs ajoutés</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Clubs suivis</div>
          <div className="kpi-value">{[...new Set(cards.map((c) => c.club))].length}</div>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Club</th>
              <th>Titulaire</th>
              <th>Prix abonnement</th>
              <th>Frais carte</th>
              <th>Coût membership</th>
              <th>Dépense totale</th>
              <th>Nb matchs champ.</th>
              <th>Prix / match</th>
            </tr>
          </thead>
          <tbody>
            {cards.map((c) => {
              const col = CLUB_COLOR[c.club] || { bg: "#eee", fg: "#333" };
              const { champCount: cChampCount, perMatch: cPerMatch } = getCardStats(c);
              const cTotalSpend = getCardTotalSpend(c);
              return (
                <tr key={c.id}>
                  <td>
                    <span className="tag-club" style={{ background: col.bg, color: col.fg }}>
                      {CLUB_LABEL[c.club]}
                    </span>
                  </td>
                  <td className="cell-event">{c.holder}</td>
                  <td className="cell-num">{fmtMoney(c.aboPrice)}</td>
                  <td className="cell-num">{c.extraCard ? fmtMoney(c.extraCard) : "—"}</td>
                  <td className="cell-num">
                    {fmtMoney(c.aboPrice + c.extraCard)}
                  </td>
                  <td className="cell-num" style={{ fontWeight: 700 }}>
                    {fmtMoney(cTotalSpend)}
                  </td>
                  <td className="cell-num">{cChampCount}</td>
                  <td className="cell-num">{fmtMoney(cPerMatch)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ============================================================
   CONCERTS VIEW
   ============================================================ */
function ConcertsView({ state, updateState }) {
  const concerts = state.concerts;

  const addConcert = () => {
    updateState((s) => {
      s.concerts.unshift({
        id: uid(),
        artiste: "",
        date: "",
        lieu: "",
        categorie: "",
        quantite: 1,
        prixAchat: 0,
        status: "stock",
        acheteur: "",
        prixVente: null,
      });
    });
  };

  const updateConcert = (id, field, value) => {
    updateState((s) => {
      const c = s.concerts.find((x) => x.id === id);
      if (field === "prixVente") c[field] = value === "" ? null : parseFloat(value);
      else if (field === "prixAchat" || field === "quantite") c[field] = parseFloat(value) || 0;
      else c[field] = value;
    });
  };

  const deleteConcert = (id) => {
    updateState((s) => {
      s.concerts = s.concerts.filter((c) => c.id !== id);
    });
  };

  let totalAchat = 0,
    totalVente = 0,
    nbVendu = 0;
  concerts.forEach((c) => {
    totalAchat += parseFloat(c.prixAchat) || 0;
    if (c.status === "vendu") {
      nbVendu++;
      totalVente += parseFloat(c.prixVente) || 0;
    }
  });
  const totalBenef =
    totalVente - concerts.filter((c) => c.status === "vendu").reduce((s, c) => s + (parseFloat(c.prixAchat) || 0), 0);

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <h1 className="view-title">Concerts</h1>
          <div className="view-desc">Tes billets de concert : stock, vendu, acompte, et à qui.</div>
        </div>
        <button className="btn btn-primary" onClick={addConcert}>
          + Ajouter un billet concert
        </button>
      </div>
      <div className="kpi-row">
        <div className="kpi">
          <div className="kpi-label">Billets concerts</div>
          <div className="kpi-value">{concerts.length}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Dépense totale</div>
          <div className="kpi-value">{fmtMoney0(totalAchat)}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Vendus</div>
          <div className="kpi-value pos">{nbVendu}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Bénéfice net</div>
          <div className={"kpi-value " + (totalBenef >= 0 ? "pos" : "neg")}>{fmtMoney0(totalBenef)}</div>
        </div>
      </div>

      {concerts.length === 0 ? (
        <div className="empty">
          <div className="empty-title">Aucun billet de concert pour le moment</div>
          <div>Clique sur "+ Ajouter un billet concert" pour commencer ton suivi.</div>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Artiste / événement</th>
                <th>Date</th>
                <th>Lieu</th>
                <th>Catégorie</th>
                <th>Qté</th>
                <th>Prix achat</th>
                <th>Statut</th>
                <th>Acheteur</th>
                <th>Prix vente</th>
                <th>Bénéfice</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {concerts.map((c) => {
                const b =
                  c.prixVente !== null && c.prixVente !== undefined
                    ? parseFloat(c.prixVente) - parseFloat(c.prixAchat || 0)
                    : null;
                const bClass = b === null ? "benefice-zero" : b >= 0 ? "benefice-pos" : "benefice-neg";
                return (
                  <tr key={c.id}>
                    <td>
                      <input
                        className="inline-input"
                        value={c.artiste}
                        onChange={(e) => updateConcert(c.id, "artiste", e.target.value)}
                        placeholder="Nom de l'artiste"
                      />
                    </td>
                    <td>
                      <input
                        className="inline-input"
                        type="date"
                        value={c.date}
                        onChange={(e) => updateConcert(c.id, "date", e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        className="inline-input"
                        value={c.lieu}
                        onChange={(e) => updateConcert(c.id, "lieu", e.target.value)}
                        placeholder="Salle / ville"
                      />
                    </td>
                    <td>
                      <input
                        className="inline-input"
                        value={c.categorie}
                        onChange={(e) => updateConcert(c.id, "categorie", e.target.value)}
                        placeholder="Catégorie"
                      />
                    </td>
                    <td>
                      <input
                        className="inline-input"
                        type="number"
                        min="1"
                        style={{ width: 60 }}
                        value={c.quantite}
                        onChange={(e) => updateConcert(c.id, "quantite", e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        className="inline-input"
                        type="number"
                        step="0.01"
                        value={c.prixAchat}
                        onChange={(e) => updateConcert(c.id, "prixAchat", e.target.value)}
                      />
                    </td>
                    <td>
                      <select
                        className="inline-input"
                        value={c.status}
                        onChange={(e) => updateConcert(c.id, "status", e.target.value)}
                      >
                        {Object.entries(STATUS_DEFS).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        className="inline-input"
                        value={c.acheteur}
                        onChange={(e) => updateConcert(c.id, "acheteur", e.target.value)}
                        placeholder="—"
                      />
                    </td>
                    <td>
                      <input
                        className="inline-input"
                        type="number"
                        step="0.01"
                        value={c.prixVente ?? ""}
                        onChange={(e) => updateConcert(c.id, "prixVente", e.target.value)}
                        placeholder="—"
                      />
                    </td>
                    <td className={"cell-num " + bClass}>{b === null ? "—" : fmtMoney(b)}</td>
                    <td>
                      <button className="icon-btn" onClick={() => deleteConcert(c.id)} title="Supprimer">
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   CLIENTS VIEW — base clients auto-générée depuis les ventes
   (foot : matches vendus avec un acheteur renseigné
   concerts : billets vendus avec un acheteur renseigné)
   ============================================================ */
function buildClientsIndex(state) {
  const byClient = {}; // name (normalized) -> { displayName, purchases: [...], total }

  const addPurchase = (name, purchase) => {
    const key = name.trim().toLowerCase();
    if (!key) return;
    if (!byClient[key]) {
      byClient[key] = { displayName: name.trim(), purchases: [], total: 0 };
    }
    byClient[key].purchases.push(purchase);
    byClient[key].total += purchase.montant || 0;
  };

  state.cards.forEach((c) => {
    c.matches.forEach((m) => {
      if (m.status === "vendu" && m.acheteur && m.acheteur.trim()) {
        addPurchase(m.acheteur, {
          type: "foot",
          club: CLUB_LABEL[c.club] || c.club,
          carte: c.holder,
          match: m.event,
          date: m.dateVente || m.date,
          montant: parseFloat(m.prixVente) || 0,
          lieu: m.lieuVente || "",
        });
      }
    });
  });

  state.concerts.forEach((c) => {
    if (c.status === "vendu" && c.acheteur && c.acheteur.trim()) {
      addPurchase(c.acheteur, {
        type: "concert",
        club: null,
        carte: c.artiste || "Concert",
        match: c.artiste ? c.artiste : "(sans nom)",
        date: c.date,
        montant: parseFloat(c.prixVente) || 0,
        lieu: c.lieu || "",
      });
    }
  });

  return Object.values(byClient).sort((a, b) => b.total - a.total);
}

function ClientsView({ state }) {
  const clients = buildClientsIndex(state);
  const totalRevenue = clients.reduce((s, c) => s + c.total, 0);
  const totalPurchases = clients.reduce((s, c) => s + c.purchases.length, 0);

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <h1 className="view-title">Base clients</h1>
          <div className="view-desc">
            Générée automatiquement à partir de tous les billets vendus (foot + concerts) où un acheteur est renseigné.
          </div>
        </div>
      </div>

      <div className="kpi-row">
        <div className="kpi">
          <div className="kpi-label">Clients distincts</div>
          <div className="kpi-value">{clients.length}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Achats enregistrés</div>
          <div className="kpi-value">{totalPurchases}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Revenus totaux</div>
          <div className="kpi-value pos">{fmtMoney0(totalRevenue)}</div>
        </div>
      </div>

      {clients.length === 0 ? (
        <div className="empty">
          <div className="empty-title">Aucun client pour le moment</div>
          <div>Dès qu'un billet est vendu avec un nom d'acheteur, il apparaîtra ici automatiquement.</div>
        </div>
      ) : (
        clients.map((cl) => (
          <div className="client-card" key={cl.displayName}>
            <div className="client-head">
              <div className="client-name">{cl.displayName}</div>
              <div className="client-meta">
                {cl.purchases.length} achat{cl.purchases.length > 1 ? "s" : ""} — total {fmtMoney0(cl.total)}
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Club</th>
                    <th>Match / événement</th>
                    <th>Date</th>
                    <th>Lieu vente</th>
                    <th>Montant</th>
                  </tr>
                </thead>
                <tbody>
                  {cl.purchases.map((p, i) => (
                    <tr key={i}>
                      <td>{p.type === "foot" ? "Foot" : "Concert"}</td>
                      <td>{p.club || "—"}</td>
                      <td className="cell-event">{p.match}</td>
                      <td className="cell-date">{fmtDate(p.date)}</td>
                      <td>{p.lieu || "—"}</td>
                      <td className="cell-num">{fmtMoney(p.montant)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

/* ============================================================
   RECAP VIEW
   ============================================================ */
function RecapView({ state }) {
  const cards = state.cards;
  let footRemaining = 0;
  cards.forEach((c) => {
    c.matches.forEach((m) => {
      if (m.status === "stock" || m.status === "acompte") footRemaining++;
    });
  });
  const footBenef = cards.reduce(
    (s, c) => s + c.matches.filter((m) => m.status === "vendu").reduce((s2, m) => s2 + (benefice(m) || 0), 0),
    0
  );

  let concertRemaining = state.concerts.filter((c) => c.status === "stock" || c.status === "acompte").length;
  let concertRevenue = state.concerts.filter((c) => c.status === "vendu").reduce((s, c) => s + (parseFloat(c.prixVente) || 0), 0);
  let concertSpendSold = state.concerts
    .filter((c) => c.status === "vendu")
    .reduce((s, c) => s + (parseFloat(c.prixAchat) || 0), 0);
  let concertBenef = concertRevenue - concertSpendSold;

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <h1 className="view-title">Récap général</h1>
          <div className="view-desc">Tout ce qu'il te reste à vendre ou à suivre, foot + concerts.</div>
        </div>
      </div>
      <div className="kpi-row">
        <div className="kpi">
          <div className="kpi-label">Billets foot restants</div>
          <div className="kpi-value">{footRemaining}</div>
          <div className="kpi-sub">en stock ou acompte</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Bénéfice foot réalisé</div>
          <div className={"kpi-value " + (footBenef >= 0 ? "pos" : "neg")}>{fmtMoney0(footBenef)}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Billets concerts restants</div>
          <div className="kpi-value">{concertRemaining}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Bénéfice concerts réalisé</div>
          <div className={"kpi-value " + (concertBenef >= 0 ? "pos" : "neg")}>{fmtMoney0(concertBenef)}</div>
        </div>
      </div>
      <div className="recap-grid">
        <div className="section">
          <div className="section-title">Foot — par carte d'abonnement</div>
          {cards.map((c) => {
            const stock = c.matches.filter((m) => m.status === "stock").length;
            const acompte = c.matches.filter((m) => m.status === "acompte").length;
            const vendu = c.matches.filter((m) => m.status === "vendu").length;
            const indispo = c.matches.filter((m) => m.status === "indispo").length;
            const col = CLUB_COLOR[c.club] || { bg: "#eee", fg: "#333" };
            return (
              <div className="recap-row" key={c.id}>
                <div>
                  <span className="label">
                    <span className="tag-club" style={{ background: col.bg, color: col.fg }}>
                      {CLUB_LABEL[c.club]}
                    </span>{" "}
                    {c.holder}
                  </span>
                  <span className="sub">
                    {stock} en stock · {acompte} acompte · {indispo} indispo
                  </span>
                </div>
                <div className="val">
                  {vendu} vendu{vendu > 1 ? "s" : ""}
                </div>
              </div>
            );
          })}
        </div>
        <div className="section">
          <div className="section-title">Concerts — par événement</div>
          {state.concerts.length === 0 ? (
            <div className="empty" style={{ padding: 20 }}>
              <div className="empty-title">Aucun billet concert</div>
            </div>
          ) : (
            state.concerts.map((c) => (
              <div className="recap-row" key={c.id}>
                <div>
                  <span className="label">{c.artiste || "(sans nom)"}</span>
                  <span className="sub">
                    {c.lieu || "—"} · {fmtDate(c.date)}
                  </span>
                </div>
                <div>
                  <StatusBadge status={c.status} />
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
