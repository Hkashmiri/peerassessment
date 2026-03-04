import { i } from "@instantdb/react";

const _schema = i.schema({
  entities: {
    $files: i.entity({
      path: i.string().unique().indexed(),
      url: i.string(),
    }),
    $users: i.entity({
      email: i.string().unique().indexed().optional(),
      imageURL: i.string().optional(),
      type: i.string().optional(),
    }),
    groups: i.entity({
      name: i.string(),
      code: i.string().unique().indexed(),
      createdAt: i.number(),
    }),
    members: i.entity({
      groupCode: i.string().indexed(),
      displayName: i.string(),
      memberNameKey: i.string().unique().indexed(),
      localMemberToken: i.string().indexed(),
      active: i.boolean(),
      joinedAt: i.number(),
      lastContributionAt: i.number().optional(),
      removedReason: i.string().optional(),
    }),
    contributions: i.entity({
      groupCode: i.string().indexed(),
      memberId: i.string().indexed(),
      note: i.string(),
      createdAt: i.number(),
    }),
    reviews: i.entity({
      groupCode: i.string().indexed(),
      targetMemberId: i.string().indexed(),
      voterToken: i.string().indexed(),
      feedback: i.string(),
      contributionScore: i.number(),
      voteOut: i.boolean(),
      createdAt: i.number(),
    }),
  },
  links: {
    $usersLinkedPrimaryUser: {
      forward: {
        on: "$users",
        has: "one",
        label: "linkedPrimaryUser",
        onDelete: "cascade",
      },
      reverse: {
        on: "$users",
        has: "many",
        label: "linkedGuestUsers",
      },
    },
  },
});

type _AppSchema = typeof _schema;
interface AppSchema extends _AppSchema {}
const schema: AppSchema = _schema;

export type { AppSchema };
export default schema;
