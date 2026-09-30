/**
 * The two things scouts and strategists actually touch, drawn from the product's real layout:
 * the phone match form and the pick list you drag. Structure and behaviour only, no numbers, so it
 * cannot read as a result. Decorative; the figure captions say what each one is.
 */
export function ScoutingDemo() {
  return (
    <section className="mk-scout-demo" aria-labelledby="mk-scout-demo-title">
      <div className="lux-content">
        <header className="lux-section-head">
          <p className="lux-eyebrow">Built for the stands</p>
          <h2 id="mk-scout-demo-title">Scout on a phone. Pick from a list you drag.</h2>
          <p>
            Entries stay on the phone with no signal and send when it is back. Leads see who still needs
            a scout, and the whole team ranks alliance picks in one place.
          </p>
        </header>
        <div className="mk-scout-demo-grid">
          <figure className="mk-scout-phone-wrap">
            <div className="mk-scout-phone" aria-hidden="true">
              <div className="mk-scout-phone-top">
                <b>Match scouting</b>
                <span>Next to scout</span>
              </div>
              <div className="mk-scout-alliances">
                <i className="red">Red 1<small>Done</small></i>
                <i className="red is-next">Red 2</i>
                <i className="red">Red 3<small>Done</small></i>
                <i className="blue">Blue 1</i>
                <i className="blue">Blue 2</i>
                <i className="blue">Blue 3</i>
              </div>
              <div className="mk-scout-tabs">
                <span className="is-on">Auto</span>
                <span>Teleop</span>
                <span>Endgame</span>
                <span>Review</span>
              </div>
              <div className="mk-scout-field">
                <label>Auto points</label>
                <div className="mk-scout-stepper"><b>−</b><span>0</span><b className="plus">+</b></div>
              </div>
              <div className="mk-scout-field">
                <label>Endgame</label>
                <div className="mk-scout-chips"><span>None</span><span>Park</span><span>Climb</span></div>
              </div>
              <div className="mk-scout-route">
                {Array.from({ length: 18 }, (_, index) => (
                  <span key={index} className={index === 4 || index === 9 ? "on" : undefined} />
                ))}
              </div>
              <div className="mk-scout-save">Save this match</div>
              <p className="mk-scout-offline">Saved on this phone. Sends when you are back online.</p>
            </div>
            <figcaption>
              <strong>The match form, one phase at a time.</strong>
              <span>Phase tabs, big tap targets and your next robot already selected.</span>
            </figcaption>
          </figure>

          <figure className="mk-scout-picks-wrap">
            <div className="mk-scout-picks" aria-hidden="true">
              <div className="mk-scout-tier">
                <h3>First picks</h3>
                <ul>
                  <li><em>⋮⋮</em><span><b>Robot A</b><small>Our scouting · matches watched</small></span><u>Vote</u></li>
                  <li className="lifted"><em>⋮⋮</em><span><b>Robot B</b><small>Our scouting · matches watched</small></span><u>Vote</u></li>
                  <li className="slot" />
                  <li><em>⋮⋮</em><span><b>Robot C</b><small>Our scouting · matches watched</small></span><u>Vote</u></li>
                </ul>
              </div>
              <div className="mk-scout-tier">
                <h3>Second picks</h3>
                <ul>
                  <li><em>⋮⋮</em><span><b>Robot D</b><small>Our scouting · matches watched</small></span><u>Vote</u></li>
                  <li><em>⋮⋮</em><span><b>Robot E</b><small>Our scouting · matches watched</small></span><u>Vote</u></li>
                </ul>
              </div>
            </div>
            <figcaption>
              <strong>Rank by dragging, from any device.</strong>
              <span>Sliders suggest an order from your scouting; you and your teammates decide the final one.</span>
            </figcaption>
          </figure>
        </div>
      </div>
    </section>
  );
}
