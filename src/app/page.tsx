"use client";

import { db } from "@/lib/db";
import type { AppSchema } from "@/instant.schema";
import { id, InstaQLEntity } from "@instantdb/react";
import { useEffect, useMemo, useState } from "react";

type Group = InstaQLEntity<AppSchema, "groups">;
type Member = InstaQLEntity<AppSchema, "members">;
type Contribution = InstaQLEntity<AppSchema, "contributions">;
type Review = InstaQLEntity<AppSchema, "reviews">;

const STORAGE_KEYS = {
  activeGroup: "peer-assessment-active-group",
  deviceToken: "peer-assessment-device-token",
  memberTokenPrefix: "peer-assessment-member-token",
};

const ONE_DAY_MS = 1000 * 60 * 60 * 24;
const INACTIVITY_DAYS = 7;

function normalizeCode(raw: string) {
  return raw.replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 8);
}

function normalizeName(raw: string) {
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
}

function buildMemberNameKey(groupCode: string, displayName: string) {
  return `${groupCode}:${normalizeName(displayName)}`;
}

function createGroupCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function safeGetStorage(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Ignore storage errors (private mode, blocked storage).
  }
}

function safeRandomId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function getOrCreateDeviceToken() {
  const existing = safeGetStorage(STORAGE_KEYS.deviceToken);
  if (existing) {
    return existing;
  }

  const created = safeRandomId();
  safeSetStorage(STORAGE_KEYS.deviceToken, created);
  return created;
}

function memberTokenKey(groupCode: string) {
  return `${STORAGE_KEYS.memberTokenPrefix}:${groupCode}`;
}

function getOrCreateMemberToken(groupCode: string) {
  const key = memberTokenKey(groupCode);
  const existing = safeGetStorage(key);
  if (existing) {
    return existing;
  }

  const created = safeRandomId();
  safeSetStorage(key, created);
  return created;
}

function formatRelativeDays(timestamp: number) {
  const diffDays = Math.floor((Date.now() - timestamp) / ONE_DAY_MS);
  if (diffDays <= 0) return "today";
  if (diffDays === 1) return "1 day ago";
  return `${diffDays} days ago`;
}

export default function HomePage() {
  const { isLoading, error, data } = db.useQuery({
    groups: {},
    members: {},
    contributions: {},
    reviews: {},
  });

  const [groupName, setGroupName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [selectedGroupCode, setSelectedGroupCode] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [contributionNote, setContributionNote] = useState("");
  const [feedbackText, setFeedbackText] = useState("");
  const [targetMemberId, setTargetMemberId] = useState("");
  const [contributionScore, setContributionScore] = useState(3);
  const [voteOut, setVoteOut] = useState(false);
  const [nameError, setNameError] = useState("");

  useEffect(() => {
    const storedGroup = safeGetStorage(STORAGE_KEYS.activeGroup);
    if (storedGroup) {
      setSelectedGroupCode(storedGroup);
    }

    getOrCreateDeviceToken();
  }, []);

  useEffect(() => {
    if (!selectedGroupCode) return;
    safeSetStorage(STORAGE_KEYS.activeGroup, selectedGroupCode);
  }, [selectedGroupCode]);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);

  const groups = data?.groups ?? [];
  const members = data?.members ?? [];
  const contributions = data?.contributions ?? [];
  const reviews = data?.reviews ?? [];

  const activeGroup = useMemo(
    () => groups.find((group) => group.code === selectedGroupCode),
    [groups, selectedGroupCode],
  );

  const groupMembers = useMemo(
    () => members.filter((member) => member.groupCode === selectedGroupCode),
    [members, selectedGroupCode],
  );

  const activeMembers = useMemo(
    () => groupMembers.filter((member) => member.active),
    [groupMembers],
  );

  const groupContributions = useMemo(
    () => contributions.filter((entry) => entry.groupCode === selectedGroupCode),
    [contributions, selectedGroupCode],
  );

  const groupReviews = useMemo(
    () => reviews.filter((review) => review.groupCode === selectedGroupCode),
    [reviews, selectedGroupCode],
  );

  function isNameTaken(
    groupCode: string,
    displayNameInput: string,
    ignoreMemberId?: string,
  ) {
    const normalized = normalizeName(displayNameInput);
    return members.some(
      (member) =>
        member.groupCode === groupCode &&
        member.id !== ignoreMemberId &&
        normalizeName(member.displayName) === normalized,
    );
  }

  const currentMember = useMemo(() => {
    if (!selectedGroupCode) return null;
    const token = safeGetStorage(memberTokenKey(selectedGroupCode));
    if (!token) return null;
    return (
      groupMembers.find((member) => member.localMemberToken === token) ?? null
    );
  }, [groupMembers, selectedGroupCode]);

  const reviewTargetOptions = useMemo(
    () =>
      activeMembers.filter(
        (member) => !currentMember || member.id !== currentMember.id,
      ),
    [activeMembers, currentMember],
  );

  useEffect(() => {
    if (!reviewTargetOptions.length) {
      setTargetMemberId("");
      return;
    }

    setTargetMemberId((existing) => {
      if (reviewTargetOptions.some((member) => member.id === existing)) {
        return existing;
      }
      return reviewTargetOptions[0].id;
    });
  }, [reviewTargetOptions]);

  function evaluateMember(memberId: string) {
    const memberReviews = groupReviews.filter(
      (review) => review.targetMemberId === memberId,
    );

    if (!memberReviews.length) {
      return;
    }

    const voteCount = memberReviews.filter((review) => review.voteOut).length;
    const avgScore =
      memberReviews.reduce((sum, review) => sum + review.contributionScore, 0) /
      memberReviews.length;

    const majorityThreshold = Math.ceil(activeMembers.length / 2);
    const isVotedOut = voteCount >= majorityThreshold && voteCount > 0;
    const lowScoreThreshold =
      memberReviews.length >= Math.max(2, activeMembers.length - 1) && avgScore <= 1.8;

    if (isVotedOut) {
      db.transact(
        db.tx.members[memberId].update({
          active: false,
          removedReason: "Removed by anonymous majority vote.",
        }),
      );
      return;
    }

    if (lowScoreThreshold) {
      db.transact(
        db.tx.members[memberId].update({
          active: false,
          removedReason: "Removed for consistently low contribution scores.",
        }),
      );
    }
  }

  function runInactivityAudit() {
    const cutoff = Date.now() - INACTIVITY_DAYS * ONE_DAY_MS;

    const inactiveMembers = activeMembers.filter((member) => {
      const lastSeen = member.lastContributionAt ?? member.joinedAt;
      return lastSeen < cutoff;
    });

    if (!inactiveMembers.length) {
      return;
    }

    db.transact(
      inactiveMembers.map((member) =>
        db.tx.members[member.id].update({
          active: false,
          removedReason: `Removed for no contribution in ${INACTIVITY_DAYS}+ days.`,
        }),
      ),
    );
  }

  function createGroup() {
    if (!groupName.trim() || !displayName.trim()) {
      return;
    }

    let generatedCode = createGroupCode();
    while (groups.some((group) => group.code === generatedCode)) {
      generatedCode = createGroupCode();
    }

    const cleanName = displayName.trim();
    if (isNameTaken(generatedCode, cleanName)) {
      setNameError("That name is already used in this group.");
      return;
    }

    setNameError("");
    const memberToken = getOrCreateMemberToken(generatedCode);
    const now = Date.now();

    db.transact([
      db.tx.groups[id()].update({
        name: groupName.trim(),
        code: generatedCode,
        createdAt: now,
      }),
      db.tx.members[id()].update({
        groupCode: generatedCode,
        displayName: cleanName,
        memberNameKey: buildMemberNameKey(generatedCode, cleanName),
        localMemberToken: memberToken,
        active: true,
        joinedAt: now,
        lastContributionAt: now,
      }),
    ]);

    setSelectedGroupCode(generatedCode);
    setJoinCode(generatedCode);
    setGroupName("");
  }

  function joinGroup() {
    const code = normalizeCode(joinCode);
    if (!code || !displayName.trim()) {
      return;
    }

    const groupExists = groups.some((group) => group.code === code);
    if (!groupExists) {
      return;
    }

    const token = getOrCreateMemberToken(code);
    const existingMember = members.find(
      (member) => member.groupCode === code && member.localMemberToken === token,
    );
    const cleanName = displayName.trim();

    if (isNameTaken(code, cleanName, existingMember?.id)) {
      setNameError("That name is already taken in this group.");
      return;
    }

    setNameError("");

    if (!existingMember) {
      db.transact(
        db.tx.members[id()].update({
          groupCode: code,
          displayName: cleanName,
          memberNameKey: buildMemberNameKey(code, cleanName),
          localMemberToken: token,
          active: true,
          joinedAt: Date.now(),
          lastContributionAt: Date.now(),
        }),
      );
    } else if (existingMember.displayName !== cleanName) {
      db.transact(
        db.tx.members[existingMember.id].update({
          displayName: cleanName,
          memberNameKey: buildMemberNameKey(code, cleanName),
        }),
      );
    }

    setSelectedGroupCode(code);
  }

  function addTeammate() {
    if (!selectedGroupCode || !inviteName.trim()) {
      return;
    }
    const cleanName = inviteName.trim();
    if (isNameTaken(selectedGroupCode, cleanName)) {
      setNameError("That teammate name already exists in this group.");
      return;
    }

    setNameError("");

    db.transact(
      db.tx.members[id()].update({
        groupCode: selectedGroupCode,
        displayName: cleanName,
        memberNameKey: buildMemberNameKey(selectedGroupCode, cleanName),
        localMemberToken: `invite-${safeRandomId()}`,
        active: true,
        joinedAt: Date.now(),
      }),
    );
    setInviteName("");
  }

  function logContribution() {
    if (!currentMember || !currentMember.active || !contributionNote.trim()) {
      return;
    }

    const now = Date.now();
    db.transact([
      db.tx.contributions[id()].update({
        groupCode: selectedGroupCode,
        memberId: currentMember.id,
        note: contributionNote.trim(),
        createdAt: now,
      }),
      db.tx.members[currentMember.id].update({
        lastContributionAt: now,
      }),
    ]);

    setContributionNote("");
  }

  function submitReview() {
    if (!currentMember || !currentMember.active || !targetMemberId) {
      return;
    }
    if (targetMemberId === currentMember.id) {
      return;
    }

    const voterToken = getOrCreateDeviceToken();
    const existing = groupReviews.find(
      (review) =>
        review.targetMemberId === targetMemberId && review.voterToken === voterToken,
    );

    if (existing) {
      db.transact(
        db.tx.reviews[existing.id].update({
          feedback: feedbackText.trim(),
          contributionScore,
          voteOut,
          createdAt: Date.now(),
        }),
      );
    } else {
      db.transact(
        db.tx.reviews[id()].update({
          groupCode: selectedGroupCode,
          targetMemberId,
          voterToken,
          feedback: feedbackText.trim(),
          contributionScore,
          voteOut,
          createdAt: Date.now(),
        }),
      );
    }

    evaluateMember(targetMemberId);
    setFeedbackText("");
    setContributionScore(3);
    setVoteOut(false);
  }

  if (isLoading) {
    return <main className="page">Loading Peer Assessment...</main>;
  }

  if (error) {
    return <main className="page">Error: {error.message}</main>;
  }

  const contributionByMember = new Map<string, Contribution[]>();
  for (const entry of groupContributions) {
    const arr = contributionByMember.get(entry.memberId) ?? [];
    arr.push(entry);
    contributionByMember.set(entry.memberId, arr);
  }

  const reviewByTarget = new Map<string, Review[]>();
  for (const review of groupReviews) {
    const arr = reviewByTarget.get(review.targetMemberId) ?? [];
    arr.push(review);
    reviewByTarget.set(review.targetMemberId, arr);
  }

  return (
    <main className="page">
      <section className="hero">
        <p className="eyebrow">Peer Assessment</p>
        <h1>Group projects, without the freeloading.</h1>
        <p>
          Anonymous accountability for every teammate. Track real contributions,
          collect honest feedback, and remove non-contributors.
        </p>
      </section>

      {!activeGroup ? (
        <section className="card grid-two">
          <div>
            <h2>Create a Group</h2>
            <input
              placeholder="Group name"
              value={groupName}
              onChange={(event) => setGroupName(event.target.value)}
            />
            <input
              placeholder="Your name"
              value={displayName}
              onChange={(event) => {
                setDisplayName(event.target.value);
                setNameError("");
              }}
            />
            <button className="primary" onClick={createGroup}>
              Create Group
            </button>
          </div>
          <div>
            <h2>Join a Group</h2>
            <input
              placeholder="Group code"
              value={joinCode}
              onChange={(event) => setJoinCode(normalizeCode(event.target.value))}
            />
            <input
              placeholder="Your name"
              value={displayName}
              onChange={(event) => {
                setDisplayName(event.target.value);
                setNameError("");
              }}
            />
            <button className="primary" onClick={joinGroup}>
              Join Group
            </button>
          </div>
          {nameError && <p className="warning">{nameError}</p>}
        </section>
      ) : (
        <>
          <section className="card">
            <div className="stack-row">
              <div>
                <h2>{activeGroup.name}</h2>
                <p className="meta">Group code: {activeGroup.code}</p>
              </div>
              <div className="stack-row small-gap">
                <button
                  className="secondary"
                  onClick={() => setSelectedGroupCode("")}
                >
                  Switch Group
                </button>
                <button className="danger" onClick={runInactivityAudit}>
                  Run Contribution Audit
                </button>
              </div>
            </div>

            {!currentMember && (
              <p className="warning">
                This device is not registered as a member in this group. Join with
                your own name from the entry screen.
              </p>
            )}

            {currentMember && !currentMember.active && (
              <p className="warning">
                You were removed from this group. Reason: {currentMember.removedReason}
              </p>
            )}

            <div className="stack-row wrap">
              <input
                placeholder="Add teammate name"
                value={inviteName}
                onChange={(event) => {
                  setInviteName(event.target.value);
                  setNameError("");
                }}
              />
              <button className="secondary" onClick={addTeammate}>
                Add Teammate
              </button>
            </div>
            {nameError && <p className="warning">{nameError}</p>}
          </section>

          <section className="grid-two">
            <div className="card">
              <h2>Log Your Contribution</h2>
              <textarea
                placeholder="What did you complete for the team?"
                value={contributionNote}
                onChange={(event) => setContributionNote(event.target.value)}
              />
              <button className="primary" onClick={logContribution}>
                Save Contribution
              </button>
            </div>

            <div className="card">
              <h2>Anonymous Feedback + Vote-Out</h2>
              <select
                value={targetMemberId}
                onChange={(event) => setTargetMemberId(event.target.value)}
              >
                {reviewTargetOptions.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.displayName}
                  </option>
                ))}
              </select>
              <label className="meta">Contribution score: {contributionScore}/5</label>
              <input
                type="range"
                min={1}
                max={5}
                value={contributionScore}
                onChange={(event) => setContributionScore(Number(event.target.value))}
              />
              <textarea
                placeholder="Write what you truly think. This remains anonymous."
                value={feedbackText}
                onChange={(event) => setFeedbackText(event.target.value)}
              />
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={voteOut}
                  onChange={(event) => setVoteOut(event.target.checked)}
                />
                Vote this person out of the group
              </label>
              <button className="danger" onClick={submitReview}>
                Submit Anonymous Review
              </button>
            </div>
          </section>

          <section className="card">
            <h2>Member Accountability Board</h2>
            <div className="member-grid">
              {groupMembers.map((member) => {
                const memberContributions = contributionByMember.get(member.id) ?? [];
                const memberReviews = reviewByTarget.get(member.id) ?? [];
                const avgScore = memberReviews.length
                  ? (
                      memberReviews.reduce(
                        (sum, review) => sum + review.contributionScore,
                        0,
                      ) / memberReviews.length
                    ).toFixed(1)
                  : "-";
                const votesToRemove = memberReviews.filter((review) => review.voteOut).length;
                const lastContribution = member.lastContributionAt ?? member.joinedAt;

                return (
                  <article key={member.id} className={member.active ? "member" : "member removed"}>
                    <h3>{member.displayName}</h3>
                    <p className="meta">Status: {member.active ? "Active" : "Removed"}</p>
                    <p className="meta">Contributions logged: {memberContributions.length}</p>
                    <p className="meta">Avg peer score: {avgScore}</p>
                    <p className="meta">Vote-outs: {votesToRemove}</p>
                    <p className="meta">
                      Last contribution: {formatRelativeDays(lastContribution)}
                    </p>
                    {!member.active && member.removedReason && (
                      <p className="warning">{member.removedReason}</p>
                    )}
                    <details>
                      <summary>Peer comments</summary>
                      <ul>
                        {memberReviews.length ? (
                          memberReviews.map((review) => (
                            <li key={review.id}>"{review.feedback || "No comment"}"</li>
                          ))
                        ) : (
                          <li>No feedback yet</li>
                        )}
                      </ul>
                    </details>
                  </article>
                );
              })}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
