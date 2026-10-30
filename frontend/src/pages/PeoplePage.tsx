import { useState } from 'react';
import { PeoplePicker, PersonLabel, useDirectory, type Person, type PrincipalKind } from '@blackforestsentinel/seed-web-people';

/**
 * Beispiel für die Personen-Komponenten aus @blackforestsentinel/seed-web-people: Personen
 * auswählen und anzeigen. Mit sso und auth.directory in project.yaml kommen sie aus Microsoft Graph,
 * lokal aus auth.directory.people in public/config.json. Mit auth.directory.servicePrincipals findet
 * die Auswahl auch Anwendungen und verwaltete Identitäten (lokal: Einträge mit kind servicePrincipal).
 */
export function PeoplePage() {
  const [people, setPeople] = useState<Person[]>([]);
  const principalTypes: PrincipalKind[] | undefined = useDirectory().servicePrincipals ? ['user', 'servicePrincipal'] : undefined;

  return (
    <section>
      <h1>Personen</h1>
      <label id="people-picker-label" htmlFor="people-picker">
        {principalTypes ? 'Personen oder Anwendungen auswählen' : 'Personen auswählen'}
      </label>
      <PeoplePicker
        id="people-picker"
        aria-labelledby="people-picker-label"
        multiple
        principalTypes={principalTypes}
        value={people}
        onChange={setPeople}
      />
      {people.length > 0 && (
        <ul className="people">
          {people.map((person) => (
            <li key={person.id}>
              {/* card: Karte mit Mail und Teams-Chat beim Überfahren, bei Anwendungen Art und App-ID */}
              <PersonLabel id={person.id} person={person} secondaryField="department" card />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
