// One row per conversation comment of a pull request, plus one row per submitted review — a review
// counts as one comment for its own body and as one comment per inline comment it contains, and as one
// review whether or not it carries any comment at all. GitHub reports the replies of the review threads
// among the reviews as well; they are counted as the comments they are, see isReview.
app.importers.comments = {
  rows(context) {
    return this.conversationRows(context).concat(this.reviewRows(context)).
      map((row) => Object.assign({}, context.commonAttributes, row));
  },

  conversationRows(context) {
    var noReviewStateId = this.reviewStateId(null);

    return ((context.pullRequest.comments && context.pullRequest.comments.nodes) || []).map((comment) => ({
      time_id: dwh.lookupTimeId(comment, "createdAt"),
      pr_comment_author_id: app.importers.users.commentAuthorId(comment.author),
      pr_review_state_id: noReviewStateId,
      comments_submitted: 1
    }));
  },

  reviewRows(context) {
    var noReviewStateId = this.reviewStateId(null);
    var rows = [];

    ((context.pullRequest.reviews && context.pullRequest.reviews.nodes) || []).forEach((review) => {
      // A review without a submitted time is a pending draft of its author and is not imported.
      if (!review.submittedAt) return;

      // One row per review, so that a review with neither a body nor an inline comment — a bare
      // approval — is counted as a review too.
      let isReview = this.isReview(review);
      let row = {
        time_id: dwh.lookupTimeId(review, "submittedAt"),
        pr_comment_author_id: app.importers.users.commentAuthorId(review.author),
        pr_review_state_id: isReview
          ? this.reviewStateId(app.importers.helpers.titleize(review.state))
          : noReviewStateId
      };
      if (isReview) row.reviews_submitted = 1;

      let commentCount = ((review.comments && review.comments.totalCount) || 0) + (review.body ? 1 : 0);
      // review_comments_submitted counts only the comments a review carries, which is what Comments per
      // review divides by the reviews. Left out instead of written as a zero, so that a review without
      // comments keeps the measures empty.
      if (commentCount > 0) {
        row.comments_submitted = commentCount;
        if (isReview) row.review_comments_submitted = commentCount;
      }

      rows.push(row);
    });

    return rows;
  },

  // GitHub has no object for a single inline comment: a comment written outside the review form — a reply
  // in a review thread above all — is answered among the reviews of the pull request, as a review of its
  // own with no body, no verdict and the one comment it carries. Counted as a review, it makes the author
  // of a reply a reviewer, most often the author of the pull request answering its own reviewer.
  //
  // A body is written only by somebody submitting a review, and a submission carrying more than that one
  // comment was written in the review form.
  isReview(review) {
    if (review.body) return true;

    var comments = review.comments || {};
    if (comments.totalCount !== 1) return true;

    // A comment missing from a truncated answer counts as a review: what GitHub did not answer may not
    // turn a review into a comment.
    var comment = (comments.nodes || [])[0];
    return !comment || !comment.replyTo;
  },

  reviewStateId(reviewStateName) {
    var helpers = app.importers.helpers;
    if (!reviewStateName) {
      return dwh.dimensions.pr_review_states.
        lookupOrCreateId({id: helpers.NONE_ID}, {name: helpers.NO_REVIEW_STATE_NAME});
    }

    return dwh.dimensions.pr_review_states.lookupOrCreateId({name: reviewStateName});
  }
};
