/**
 * Drawings of the product for the public site. They follow the real screens (Home, Quick scout,
 * the scouting lead card, a pull request review, a guided step) but they are illustrations: the
 * names, tasks and teams in them are examples, every caption says so, and there are no scores,
 * counts, ratings or results in them. Decorative to assistive technology; the copy beside each
 * one says the same thing in words. On a phone each drawing keeps its main card or two
 * (`is-wide-only` marks the rest), so the page stays a story rather than a gallery.
 */

function Caption({ children }: { children: React.ReactNode }) {
  return <figcaption className="mx-caption">{children}</figcaption>;
}

function Done() {
  return <i className="mx-check" />;
}

function Open() {
  return <i className="mx-check is-open" />;
}

function QuickScoutPhone() {
  return (
    <div className="mx-phone">
      <div className="mx-phone-status">
        <span>9:41</span>
        <div className="mx-phone-notch" />
        <span className="mx-phone-icons">
          <i className="mx-phone-signal">
            <i />
            <i />
            <i />
          </i>
          <i className="mx-phone-battery" />
        </span>
      </div>
      <p className="mx-qs-top">
        <b>Quick scout</b>
        <small>Your next robot</small>
      </p>
      <div className="mx-alliance">
        <span className="is-red">Red 1</span>
        <span className="is-red is-mine">Red 2</span>
        <span className="is-red">Red 3</span>
        <span className="is-blue">Blue 1</span>
        <span className="is-blue">Blue 2</span>
        <span className="is-blue">Blue 3</span>
      </div>
      <div className="mx-phases">
        <span>Before</span>
        <span className="is-on">Auto</span>
        <span>Teleop</span>
        <span>Endgame</span>
        <span>After</span>
      </div>
      <div className="mx-tiles">
        <span className="is-held">
          Shooting<small>Hold while it shoots</small>
        </span>
        <span>
          Feeding<small>Hold while it passes</small>
        </span>
        <span>
          Defense<small>Hold while it defends</small>
        </span>
        <span>
          Stopped<small>Hold while it is dead</small>
        </span>
      </div>
      <div className="mx-receipt is-waiting">
        <i className="mx-check" />
        <span>
          <b>Saved on this phone</b>
          <small>It sends itself when the signal is back.</small>
        </span>
      </div>
    </div>
  );
}

/** The hero: Home on a laptop, Quick scout on a phone. */
export function HeroStage() {
  return (
    <figure className="mx-figure mx-hero-stage">
      <div className="mx-stage" aria-hidden="true">
        <div className="mx-window">
          <div className="mx-window-bar">
            <i />
            <i />
            <i />
            <b>Vantage · Home</b>
          </div>
          <div className="mx-home">
            <div className="mx-home-side">
              <p className="mx-home-team">
                <i />
                Your team
              </p>
              <span className="is-on">Home</span>
              <span>Competition</span>
              <span>Team</span>
              <span>Build</span>
              <span>Business</span>
            </div>
            <div className="mx-home-main">
              <p className="mx-home-date">Build season</p>
              <p className="mx-home-hello">Good evening</p>
              <div className="mx-home-grid">
                <div className="mx-card">
                  <p className="mx-card-head">
                    Your tasks <small>This week</small>
                  </p>
                  <ul className="mx-rows">
                    <li>
                      <Done />
                      <span>Wire the intake sensor</span>
                      <span className="mx-avatar">JM</span>
                    </li>
                    <li>
                      <Open />
                      <span>Order replacement belts</span>
                      <span className="mx-pill is-warn">Needs approval</span>
                    </li>
                    <li>
                      <Open />
                      <span>Finish the climber CAD</span>
                      <span className="mx-avatar">AR</span>
                    </li>
                  </ul>
                </div>
                <div className="mx-card">
                  <p className="mx-card-head">
                    Pit scouting <small>Next event</small>
                  </p>
                  <div className="mx-meter">
                    <i />
                  </div>
                  <ul className="mx-rows">
                    <li>
                      <Open />
                      <span>Team A</span>
                      <small>Not visited</small>
                    </li>
                    <li>
                      <Open />
                      <span>Team B</span>
                      <small>Not visited</small>
                    </li>
                  </ul>
                  <div className="mx-fake-btn">Visit the next pit</div>
                </div>
                <div className="mx-card is-wide">
                  <div className="mx-step-line">
                    <Done />
                    <span>
                      <b>Extrude the plate</b>
                      <small>Your first Onshape part · checked in your own Part Studio</small>
                    </span>
                    <span className="mx-pill is-ok">Checked</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <QuickScoutPhone />
      </div>
      <Caption>Illustration of Home and Quick scout. Names and tasks are examples.</Caption>
    </figure>
  );
}

/** Plan: the week, a reimbursement that needs a second person, the shop kiosk. */
export function PlanIllustration() {
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const blocks: Record<string, string[]> = {
    Mon: ["tall"],
    Tue: [""],
    Wed: ["tall", ""],
    Thu: [""],
    Fri: [],
    Sat: ["event", "event"],
    Sun: ["event"],
  };
  return (
    <figure className="mx-figure" data-mx-reveal="frame">
      <div className="mx-panel" aria-hidden="true">
        <div className="mx-card is-wide-only">
          <p className="mx-card-head">
            This week <small>Team calendar</small>
          </p>
          <div className="mx-week">
            {days.map((day) => (
              <span key={day}>
                {day}
                {(blocks[day] ?? []).map((kind, index) => (
                  <i key={`${day}-${index}`} className={kind ? `is-${kind}` : undefined} />
                ))}
              </span>
            ))}
          </div>
        </div>
        <div className="mx-panel-pair">
          <div className="mx-card">
            <p className="mx-card-head">
              Reimbursement <span className="mx-pill is-accent">Receipt attached</span>
            </p>
            <ul className="mx-claim-steps">
              <li>
                <Done />
                <span>
                  Filed by Jordan<small>Belts bought at the hardware store</small>
                </span>
              </li>
              <li>
                <Done />
                <span>
                  Approved by Sam<small>A different finance manager</small>
                </span>
              </li>
              <li>
                <Open />
                <span>
                  Paid back<small>Recorded in the team ledger</small>
                </span>
              </li>
            </ul>
          </div>
          <div className="mx-card mx-kiosk">
            <p className="mx-card-head">
              Shop kiosk <small>Hours</small>
            </p>
            <div className="mx-kiosk-field">Scan a card</div>
            <div className="mx-fake-btn">Clock in</div>
            <ul className="mx-rows">
              <li>
                <span>Riley</span>
                <span className="mx-pill is-ok">Clocked in</span>
              </li>
              <li>
                <span>Alex</span>
                <span className="mx-pill">Typed by hand</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
      <Caption>Illustration. Names and items are examples.</Caption>
    </figure>
  );
}

/** Scout: pits first, the lead's assignments, and the two honest receipts. */
export function ScoutIllustration() {
  return (
    <figure className="mx-figure" data-mx-reveal="frame">
      <div className="mx-panel" aria-hidden="true">
        <div className="mx-panel-pair">
          <div className="mx-card">
            <p className="mx-card-head">
              Pit scouting <small>Not visited first</small>
            </p>
            <div className="mx-meter">
              <i />
            </div>
            <div className="mx-fake-btn">Visit Team D</div>
            <div className="mx-pits">
              <span>Team E</span>
              <span>Team F</span>
              <span>Team G</span>
              <span className="is-done">Team A</span>
              <span className="is-done">Team B</span>
            </div>
          </div>
          <div className="mx-card">
            <p className="mx-card-head">
              Scouting lead <span className="mx-card-act">Assign scouts</span>
            </p>
            <ul className="mx-rows mx-assign">
              <li>
                <span>Red 1 · Riley</span>
                <Done />
              </li>
              <li>
                <span>Red 2</span>
                <span className="mx-pill is-warn">Needs a scout</span>
              </li>
              <li>
                <span>Red 3 · Sam</span>
                <Done />
              </li>
              <li>
                <span>Blue 1 · Jordan</span>
                <Done />
              </li>
              <li>
                <span>Disagreements</span>
                <span className="mx-pill">Review</span>
              </li>
            </ul>
          </div>
        </div>
        <div className="mx-panel-pair">
          <div className="mx-receipt is-waiting is-wide-only">
            <i className="mx-check" />
            <span>
              <b>Saved on this phone</b>
              <small>No signal. It sends itself when it can.</small>
            </span>
          </div>
          <div className="mx-receipt">
            <i className="mx-check" />
            <span>
              <b>Sent to your team</b>
              <small>Shown only once your team has it.</small>
            </span>
          </div>
        </div>
      </div>
      <Caption>Illustration. Teams and names are examples.</Caption>
    </figure>
  );
}

/** Build: a pull request review that quotes the line it is about, and the code map. */
export function BuildIllustration() {
  return (
    <figure className="mx-figure" data-mx-reveal="frame">
      <div className="mx-panel" aria-hidden="true">
        <div className="mx-card">
          <p className="mx-pr-title">
            <i />
            Intake: run the rollers on a timer
          </p>
          <p className="mx-pr-meta">Pull request · reviewed when it was opened</p>
          <pre className="mx-diff">
            <code>{"  public void periodic() {"}</code>
            <code className="is-add is-quoted">{"+   Timer.delay(0.02);"}</code>
            <code className="is-add">{"+   rollerMotor.set(0.6);"}</code>
            <code>{"  }"}</code>
          </pre>
          <div className="mx-finding">
            <p className="mx-card-head">
              Sleeping inside periodic() <span className="mx-pill is-warn">High</span>
            </p>
            <p>Blocks the robot thread, so commands, sensors and safety checks wait for the whole delay.</p>
          </div>
        </div>
        <div className="mx-card is-wide-only">
          <p className="mx-card-head">
            Code map <small>Read from your repository</small>
          </p>
          <div className="mx-map-row">
            <small>Subsystems</small>
            <div className="mx-chips">
              <span className="mx-pill">Intake</span>
              <span className="mx-pill">Shooter</span>
              <span className="mx-pill">Drivetrain</span>
              <span className="mx-pill">Climber</span>
            </div>
          </div>
          <div className="mx-map-row">
            <small>Vendor libraries</small>
            <div className="mx-chips">
              <span className="mx-pill">REVLib</span>
              <span className="mx-pill">Phoenix 6</span>
              <span className="mx-pill">PathPlanner</span>
            </div>
          </div>
        </div>
      </div>
      <Caption>Illustration. The pull request and the code are examples.</Caption>
    </figure>
  );
}

/** Learn: a checked step, a lead sign-off, a lesson the team wrote. */
export function LearnIllustration() {
  return (
    <figure className="mx-figure" data-mx-reveal="frame">
      <div className="mx-panel" aria-hidden="true">
        <div className="mx-card mx-guided-step">
          <div className="mx-guided-head">
            <b>3</b>
            <span>
              <strong>Extrude the plate</strong>
              <small>Your first Onshape part</small>
            </span>
          </div>
          <div className="mx-note">
            <small>When to use it</small>
            Turn a closed sketch into a solid part.
          </div>
          <div className="mx-note">
            <small>Example</small>
            A plate a quarter inch thick, from the rectangle you drew in step 2.
          </div>
          <div className="mx-guided-actions">
            <span className="mx-fake-btn">Check my work</span>
            <span className="mx-pill is-ok">Checked in your Part Studio</span>
          </div>
        </div>
        <div className="mx-panel-pair">
          <div className="mx-card">
            <p className="mx-card-head">Shop safety rules</p>
            <p className="mx-pill-row">
              <span className="mx-pill is-warn">Waiting for a lead</span>
            </p>
            <p className="mx-pr-meta">A lead signs this step off, or sends it back with a note.</p>
            <div className="mx-guided-actions">
              <span className="mx-fake-btn is-quiet">Send back</span>
              <span className="mx-fake-btn">Sign off</span>
            </div>
          </div>
          <div className="mx-card is-wide-only">
            <p className="mx-card-head">
              Our pit checklist <span className="mx-editor-status">Saved</span>
            </p>
            <p className="mx-pr-meta">A lesson your team wrote</p>
            <ul className="mx-rows">
              <li>
                <span>Practice questions</span>
                <span className="mx-pill is-accent">Graded by the app</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
      <Caption>Illustration. Lessons and steps are examples.</Caption>
    </figure>
  );
}
