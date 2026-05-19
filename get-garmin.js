// get-garmin.js
const { GarminConnect } = require('garmin-connect');

// Récupération des arguments passés par Obsidian
// node get-garmin.js <email> <password>
const email = process.argv[2];
const password = process.argv[3];

(async () => {
  try {
    const GC = new GarminConnect();
    await GC.login(email, password);

    // Exemple : Récupérer les stats du jour
    const userSummary = await GC.getUserSummary(new Date());

    // IMPORTANT : On renvoie les données en JSON via console.log
    // C'est ce que Obsidian va "lire"
    console.log(JSON.stringify(userSummary));
    
  } catch (error) {
    // En cas d'erreur, on l'écrit dans stderr
    console.error(JSON.stringify({ error: error.message }));
    process.exit(1);
  }
})();