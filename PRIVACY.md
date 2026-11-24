# Politique de confidentialité d’ELY-IDBox

**Dernière mise à jour : 24 novembre 2026**

ELY-IDBox aide à remplir des formulaires compatibles avec les informations d’une CIN marocaine. L’extension lit le fichier local `Extracted data.csv` produit par le logiciel du lecteur de CIN après la lecture de la carte. Elle ne communique pas directement avec la carte ni avec le lecteur.

L’extension est destinée principalement à un usage interne, pour saisir ces informations dans les formulaires métier compatibles de l’organisation. Elle peut toutefois être configurée pour d’autres sites.

## Données traitées

- **Données d’identité du fichier local `Extracted data.csv`** : selon les champs présents, nom, prénom, numéro CIN, dates de naissance et d’expiration, sexe, nationalité, numéro du document et MRZ. L’extension lit la dernière ligne de données disponible pour l’aperçu et le remplissage.
- **Site utilisé** : l’extension lit le domaine et l’URL de l’onglet actif pour appliquer la configuration du site correspondant ou reconnaître Sahty Stepper. Elle ne crée pas de liste de l’historique de navigation.
- **Formulaires de la page** : l’extension examine les champs, espaces réservés et options nécessaires pour trouver les champs à remplir. Lorsque l’utilisateur active le sélecteur de champs, elle réagit temporairement au survol et au clic pour identifier le champ choisi.
- **Réglages** : le chemin du fichier CSV, les sélecteurs de champs par site et le choix d’activer le remplissage automatique sont enregistrés dans le stockage local de Chrome.

## Utilisation et partage

Ces données servent uniquement à afficher un aperçu et à remplir les champs compatibles dans le cadre de l’usage interne prévu. Les valeurs extraites ne sont pas enregistrées dans le stockage persistant de l’extension.

ELY-IDBox ne transmet pas les données à son développeur ou à un serveur exploité par celui-ci. Elle ne vend pas les données et ne les utilise pas pour la publicité, le profilage, la solvabilité ou le prêt. Pour fournir le remplissage demandé, les valeurs sont insérées dans le formulaire du site concerné, généralement l’application interne de l’organisation. Ce site peut traiter les valeurs selon ses propres pratiques, notamment si l’utilisateur soumet le formulaire ou si le site réagit aux champs remplis.

## Conservation et contrôle

Le fichier CSV reste à l’emplacement choisi par l’utilisateur. Les réglages de l’extension restent dans le stockage local de Chrome jusqu’à leur suppression ou à la désinstallation de l’extension. L’utilisateur peut désactiver le remplissage automatique, modifier le chemin du fichier et supprimer les sélecteurs enregistrés depuis le panneau ELY-IDBox. Pour effacer le fichier CSV, il faut le supprimer séparément de l’appareil.

## Contact

Pour une question relative à la confidentialité, ouvrez un ticket sur le [dépôt GitHub d’ELY-IDBox](https://github.com/elmehdi-elfedini/ely-idbox-autofill/issues). N’y joignez pas de fichier CSV, de numéro CIN ni d’autre donnée personnelle.
