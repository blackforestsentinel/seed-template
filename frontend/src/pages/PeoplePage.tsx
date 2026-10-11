import { useState } from 'react';
import { PeoplePicker, PersonLabel, type Person } from '@blackforestsentinel/seed-web-people';

/**
 * Beispiel für die Personen-Komponenten aus @blackforestsentinel/seed-web-people: Personen
 * auswählen und anzeigen. Mit sso und auth.directory in project.yaml kommen sie aus Microsoft Graph,
 * lokal aus auth.directory.people in public/config.json.
 */
export function PeoplePage() {
  const [people, setPeople] = useState<Person[]>([]);

  return (
    <section>
      <h1>Personen</h1>
      <label id="people-picker-label" htmlFor="people-picker">
        Personen auswählen
      </label>
      <PeoplePicker id="people-picker" aria-labelledby="people-picker-label" multiple value={people} onChange={setPeople} />
      {people.length > 0 && (
        <ul className="people">
          {people.map((person) => (
            <li key={person.id}>
              {/* card: Karte mit Mail und Teams-Chat beim Überfahren */}
              <PersonLabel id={person.id} person={person} secondaryField="department" card />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
