/* CSS product mocks with real words, from docs/design-catalog.html.
   Real screenshots replace these when the app ships. Gray bars are banned. */

const NAV_ITEMS = [
  "Dashboard",
  "People",
  "Meetings",
  "Teams & tasks",
  "Giving",
  "Wiki",
];

function AppFrame({
  active,
  title,
  search,
  action,
  children,
}: {
  active: string;
  title: string;
  search?: string;
  action?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="app" aria-hidden="true">
      <div className="app-frame">
        <aside className="app-side">
          <div className="app-brand">
            <i />
            EveryField
          </div>
          <nav className="app-nav">
            {NAV_ITEMS.map((item) => (
              <span key={item} className={item === active ? "on" : undefined}>
                {item}
              </span>
            ))}
          </nav>
        </aside>
        <div className="app-main">
          <div className="app-head">
            <span className="ttl">{title}</span>
            <span className="sp" />
            {search ? <span className="app-search">{search}</span> : null}
            {action ? <span className="app-btn">{action}</span> : null}
          </div>
          <div className="app-body">{children}</div>
        </div>
      </div>
    </div>
  );
}

export function DashboardShot() {
  return (
    <AppFrame active="Dashboard" title="Dashboard" action="This week">
      <div className="astats" style={{ marginTop: 8 }}>
        <div className="astat">
          <span className="k">Committed</span>
          <span className="v">12</span>
          <span className="d">+3 this month</span>
        </div>
        <div className="astat">
          <span className="k">Vision Night #3</span>
          <span className="v">24</span>
          <span className="d">attendance, trending up</span>
        </div>
        <div className="astat">
          <span className="k">Launch goal</span>
          <span className="v">72%</span>
          <span className="d">funded</span>
        </div>
      </div>
      <div className="aprow">
        <span className="who">
          <span className="avtr">DW</span>
          <span className="nm">Follow up with Dana Whitfield</span>
        </span>
        <span className="apill">People</span>
        <span className="apnext">due Friday</span>
      </div>
      <div className="aprow">
        <span className="who">
          <span className="avtr g">VN</span>
          <span className="nm">Vision Night #5 needs a location</span>
        </span>
        <span className="apill">Meetings</span>
        <span className="apnext">2 weeks out</span>
      </div>
      <div className="aprow">
        <span className="who">
          <span className="avtr c">KD</span>
          <span className="nm">Kids team is 3 members short</span>
        </span>
        <span className="apill">Teams</span>
        <span className="apnext">before training</span>
      </div>
      <div className="achart">
        <div className="c">
          <i style={{ height: "52%" }} />
          <b>May</b>
        </div>
        <div className="c">
          <i style={{ height: "60%" }} />
          <b>Jun</b>
        </div>
        <div className="c on">
          <i style={{ height: "78%" }} />
          <b>Jul</b>
        </div>
      </div>
    </AppFrame>
  );
}

export function PeopleShot() {
  return (
    <AppFrame
      active="People"
      title="People"
      search="Search people…"
      action="Add person"
    >
      <div className="aprow">
        <span className="who">
          <span className="avtr g">MR</span>
          <span className="nm">The Rivera family</span>
        </span>
        <span className="apill ok">Committed</span>
        <span className="apnext">Dinner Thu · 7pm</span>
      </div>
      <div className="aprow">
        <span className="who">
          <span className="avtr">DW</span>
          <span className="nm">Dana Whitfield</span>
        </span>
        <span className="apill">Attended</span>
        <span className="apnext">Invite to Vision Night</span>
      </div>
      <div className="aprow">
        <span className="who">
          <span className="avtr g">OK</span>
          <span className="nm">The Okafor family</span>
        </span>
        <span className="apill ok">Committed</span>
        <span className="apnext">Kids team ask</span>
      </div>
      <div className="aprow">
        <span className="who">
          <span className="avtr c">ST</span>
          <span className="nm">Sam Torres</span>
        </span>
        <span className="apill">Attended</span>
        <span className="apnext">Follow-up call Fri</span>
      </div>
      <div className="aprow">
        <span className="who">
          <span className="avtr">GL</span>
          <span className="nm">Grace Lin</span>
        </span>
        <span className="apill">Contacted</span>
        <span className="apnext">Coffee next week</span>
      </div>
      <div className="aprow">
        <span className="who">
          <span className="avtr c">JH</span>
          <span className="nm">J.&nbsp;P. Holloway</span>
        </span>
        <span className="apill">New</span>
        <span className="apnext">First conversation</span>
      </div>
      <p className="amore">142 people · 12 committed</p>
    </AppFrame>
  );
}

export function MeetingsShot() {
  return (
    <AppFrame active="Meetings" title="Meetings" action="Plan meeting">
      <div className="apcard" style={{ marginTop: 8 }}>
        <span>
          <span className="nm">Vision Night #4</span>
          <br />
          <span className="sub">Thu Jul 30 · 7:00 PM · the Riveras&rsquo;</span>
        </span>
        <span className="sp" />
        <span className="apill ok">24 going</span>
      </div>
      <div className="aprow">
        <span className="who">
          <span className="nm">Worship team night</span>
        </span>
        <span className="apill">Tue Aug 4</span>
        <span className="apnext">8 going</span>
      </div>
      <div className="aprow">
        <span className="who">
          <span className="nm">Orientation #2</span>
        </span>
        <span className="apill">Sun Aug 9</span>
        <span className="apnext">12 invited</span>
      </div>
      <div className="achart">
        <div className="c">
          <i style={{ height: "52%" }} />
          <b>VN #1 · 18</b>
        </div>
        <div className="c">
          <i style={{ height: "66%" }} />
          <b>VN #2 · 21</b>
        </div>
        <div className="c on">
          <i style={{ height: "80%" }} />
          <b>VN #3 · 24</b>
        </div>
      </div>
    </AppFrame>
  );
}

export function TeamsShot() {
  return (
    <AppFrame active="Teams & tasks" title="Teams & tasks" action="New task">
      <div className="akan" style={{ marginTop: 12 }}>
        <div className="kcol">
          <div className="kh">
            <span>To do</span>
            <span>4</span>
          </div>
          <div className="kcard">Print connect cards</div>
          <div className="kcard">Recruit 2 greeters</div>
          <div className="kcard">Book sound check</div>
          <div className="kcard">Set up kids classrooms</div>
        </div>
        <div className="kcol">
          <div className="kh">
            <span>In progress</span>
            <span>3</span>
          </div>
          <div className="kcard">Kids check-in kit</div>
          <div className="kcard">Launch-day run sheet</div>
          <div className="kcard">Website go-live</div>
        </div>
        <div className="kcol">
          <div className="kh">
            <span>Done</span>
            <span>3</span>
          </div>
          <div className="kcard dim">Reserve school gym</div>
          <div className="kcard dim">Order signage</div>
          <div className="kcard dim">Insurance filed</div>
        </div>
      </div>
    </AppFrame>
  );
}

export function GivingShot() {
  return (
    <AppFrame active="Giving" title="Giving" action="Record commitment">
      <div className="astats">
        <div className="astat">
          <span className="k">Monthly committed</span>
          <span className="v">$4,850</span>
          <span className="d">+12% this month</span>
        </div>
        <div className="astat">
          <span className="k">Launch goal</span>
          <span className="v">72%</span>
          <span className="d">funded</span>
        </div>
        <div className="astat">
          <span className="k">Giving units</span>
          <span className="v">19</span>
          <span className="d">+3 new</span>
        </div>
      </div>
      <div className="achart">
        <div className="c">
          <i style={{ height: "32%" }} />
          <b>Feb</b>
        </div>
        <div className="c">
          <i style={{ height: "40%" }} />
          <b>Mar</b>
        </div>
        <div className="c">
          <i style={{ height: "38%" }} />
          <b>Apr</b>
        </div>
        <div className="c">
          <i style={{ height: "55%" }} />
          <b>May</b>
        </div>
        <div className="c">
          <i style={{ height: "62%" }} />
          <b>Jun</b>
        </div>
        <div className="c on">
          <i style={{ height: "80%" }} />
          <b>Jul</b>
        </div>
      </div>
    </AppFrame>
  );
}

/* ---------- focused windows for the phase tabs ---------- */

function AppWin({
  title,
  meta,
  children,
}: {
  title: string;
  meta: string;
  children: React.ReactNode;
}) {
  return (
    <div className="appwin" aria-hidden="true">
      <div className="appwin-top">
        <span className="dot" />
        <span className="ttl">{title}</span>
        <span className="meta">{meta}</span>
      </div>
      <div className="appwin-body">{children}</div>
    </div>
  );
}

export function WikiShot() {
  return (
    <AppWin title="Wiki · The EveryField Method" meta="3 of 12 chapters">
      <div className="acheck done">
        <i />
        <span>Calling &amp; self-assessment</span>
      </div>
      <div className="acheck done">
        <i />
        <span>Counting the cost</span>
      </div>
      <div className="acheck done">
        <i />
        <span>The 4 Pillars</span>
      </div>
      <div className="acheck">
        <i />
        <span>Building a core group</span>
        <span className="apill ok">reading now</span>
      </div>
      <div className="acheck">
        <i />
        <span>Vision meetings that work</span>
      </div>
      <div className="acheck">
        <i />
        <span>Ministry teams</span>
      </div>
    </AppWin>
  );
}

export function PipelineShot() {
  return (
    <AppWin title="People · Pipeline" meta="this month">
      <div className="astats" style={{ marginTop: 4 }}>
        <div className="astat">
          <span className="k">Contacted</span>
          <span className="v">38</span>
        </div>
        <div className="astat">
          <span className="k">Attended</span>
          <span className="v">21</span>
        </div>
        <div className="astat">
          <span className="k">Committed</span>
          <span className="v">12</span>
          <span className="d">+3 this month</span>
        </div>
      </div>
      <div className="aprow">
        <span className="who">
          <span className="avtr">DW</span>
          <span className="nm">Dana Whitfield</span>
        </span>
        <span className="apill">Attended</span>
      </div>
      <div className="aprow">
        <span className="who">
          <span className="avtr g">OK</span>
          <span className="nm">The Okafor family</span>
        </span>
        <span className="apill ok">Committed</span>
      </div>
      <div className="aprow">
        <span className="who">
          <span className="avtr c">GL</span>
          <span className="nm">Grace Lin</span>
        </span>
        <span className="apill">Contacted</span>
      </div>
    </AppWin>
  );
}

export function CommitmentsShot() {
  return (
    <AppWin title="Commitments" meta="the 50-adult floor">
      <div className="apcard" style={{ marginTop: 4 }}>
        <span>
          <span className="nm">34 of 50 adults</span>
          <br />
          <span className="sub">committed to launch</span>
        </span>
        <span className="sp" />
        <span className="abar" style={{ maxWidth: 140 }}>
          <i style={{ width: "68%" }} />
        </span>
      </div>
      <div className="aprow">
        <span className="who">
          <span className="avtr g">MR</span>
          <span className="nm">Rivera family</span>
        </span>
        <span className="apill ok">signed Jul 12</span>
      </div>
      <div className="aprow">
        <span className="who">
          <span className="avtr g">OK</span>
          <span className="nm">Okafor family</span>
        </span>
        <span className="apill ok">signed Jul 18</span>
      </div>
      <div className="aprow">
        <span className="who">
          <span className="avtr">DW</span>
          <span className="nm">Dana Whitfield</span>
        </span>
        <span className="apill">card out</span>
      </div>
    </AppWin>
  );
}

export function TrainingShot() {
  return (
    <AppWin title="Training readiness" meta="8 ministry areas">
      <div className="aptrain">
        <span>Worship</span>
        <span className="abar">
          <i style={{ width: "80%" }} />
        </span>
        <span className="n">4/5</span>
      </div>
      <div className="aptrain">
        <span>Kids</span>
        <span className="abar">
          <i style={{ width: "50%" }} />
        </span>
        <span className="n">3/6</span>
      </div>
      <div className="aptrain">
        <span>Hospitality</span>
        <span className="abar">
          <i style={{ width: "100%" }} />
        </span>
        <span className="n">5/5</span>
      </div>
      <div className="aptrain">
        <span>Production</span>
        <span className="abar">
          <i style={{ width: "50%" }} />
        </span>
        <span className="n">2/4</span>
      </div>
      <div className="aptrain">
        <span>Prayer</span>
        <span className="abar">
          <i style={{ width: "100%" }} />
        </span>
        <span className="n">3/3</span>
      </div>
      <p className="amore">17 of 23 team members trained</p>
    </AppWin>
  );
}

export function ChecklistShot() {
  return (
    <AppWin title="Pre-launch checklist" meta="21 days to Sunday">
      <div className="acheck done">
        <i />
        <span>Signage ordered</span>
      </div>
      <div className="acheck done">
        <i />
        <span>Dry run #1 complete</span>
      </div>
      <div className="acheck done">
        <i />
        <span>Promo cards mailed</span>
      </div>
      <div className="acheck">
        <i />
        <span>Print bulletins</span>
      </div>
      <div className="acheck">
        <i />
        <span>Final walkthrough with all teams</span>
      </div>
      <div className="aprow" style={{ marginTop: 6, alignItems: "center" }}>
        <span className="abar">
          <i style={{ width: "75%" }} />
        </span>
        <span className="apnext">18 of 24 done</span>
      </div>
    </AppWin>
  );
}

export function RunSheetShot() {
  return (
    <AppWin title="Run sheet · Sun Sep 14" meta="day of">
      <div className="aprun">
        <span className="tm">7:30</span>
        <span>Setup crew arrives</span>
        <span className="sp" />
        <span className="apill">Facilities</span>
      </div>
      <div className="aprun">
        <span className="tm">8:15</span>
        <span>Band call</span>
        <span className="sp" />
        <span className="apill">Worship</span>
      </div>
      <div className="aprun">
        <span className="tm">9:15</span>
        <span>Doors open</span>
        <span className="sp" />
        <span className="apill">Greeters</span>
      </div>
      <div className="aprun">
        <span className="tm">10:00</span>
        <span>Service</span>
        <span className="sp" />
        <span className="apill ok">all teams</span>
      </div>
      <div className="apcard" style={{ margin: "10px 0 0" }}>
        <span>
          <span className="nm">First-Sunday attendance</span>
          <br />
          <span className="sub">captured same day, follow-ups queued</span>
        </span>
        <span className="sp" />
        <span className="apill ok">117</span>
      </div>
    </AppWin>
  );
}

export function HealthShot() {
  return (
    <AppWin title="Health dashboard" meta="week 6 after launch">
      <div className="astats" style={{ marginTop: 4 }}>
        <div className="astat">
          <span className="k">Attendance</span>
          <span className="v">112</span>
          <span className="d">avg · +4%</span>
        </div>
        <div className="astat">
          <span className="k">Giving</span>
          <span className="v">$5.2k</span>
          <span className="d">per month</span>
        </div>
        <div className="astat">
          <span className="k">Serving</span>
          <span className="v">41</span>
          <span className="d">volunteers</span>
        </div>
      </div>
      <div className="achart" style={{ height: 78 }}>
        {[
          ["W1", "68%"],
          ["W2", "55%"],
          ["W3", "60%"],
          ["W4", "58%"],
          ["W5", "63%"],
        ].map(([label, height]) => (
          <div className="c" key={label}>
            <i style={{ height }} />
            <b>{label}</b>
          </div>
        ))}
        <div className="c on">
          <i style={{ height: "70%" }} />
          <b>W6</b>
        </div>
      </div>
    </AppWin>
  );
}
