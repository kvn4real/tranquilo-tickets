# Stade & Tribune — Suivi Abonnements & Billetterie

App Next.js pour suivre tes abonnements foot (PSG, LOSC, Paris FC, Le Mans, Monaco) et tes billets de concert : calendrier match par match, revente, memberships, récap général.

## Déploiement sur Vercel (3 étapes)

### 1. Importer le projet
- Va sur https://vercel.com/new
- Choisis "Deploy" puis glisse-dépose ce dossier (ou pousse-le sur un repo GitHub et importe-le depuis là)

### 2. Créer le store Blob
- Une fois le projet créé sur Vercel, va dans l'onglet **Storage** du projet
- Clique sur **Create Database** → **Blob**
- Connecte-le à ton projet (Vercel ajoute automatiquement la variable d'environnement `BLOB_READ_WRITE_TOKEN`)

### 3. Redéployer
- Va dans l'onglet **Deployments** et clique **Redeploy** sur le dernier déploiement (pour que la variable d'environnement Blob soit prise en compte)

C'est tout — le site est en ligne, accessible depuis n'importe quel appareil, et toutes les données (statuts, ventes, concerts) sont sauvegardées automatiquement et partagées entre tous tes appareils.

## Développement local

```bash
npm install
npm run dev
```

(nécessite aussi une variable d'environnement `BLOB_READ_WRITE_TOKEN` en local — récupérable depuis Vercel → Storage → ton store Blob → `.env.local`)
