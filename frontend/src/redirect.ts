import { handleSeedAuthRedirect } from '@blackforestsentinel/seed-web-auth/bridge';

// Reicht die Antwort von Entra ID aus dem unsichtbaren iframe an die App weiter. Das Modul sso
// trägt diese Seite als Redirect-URI ein; ohne sie erneuert die App die Sitzung per Umleitung.
void handleSeedAuthRedirect();
