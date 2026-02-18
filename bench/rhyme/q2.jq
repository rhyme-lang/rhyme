reduce (inputs | .[]) as $c (
    {};
    ($c.commit.author.name)    as $author    |
    ($c.commit.committer.name) as $committer |
    .[$author].email                                       //= $c.commit.author.email |
    .[$author].total_commits                               += 1 |
    if $author == $committer then
      .[$author].self_committed += 1
    else
      .[$author].committed_by_others[$committer].email    //= $c.commit.committer.email |
      .[$author].committed_by_others[$committer].commits  += 1
    end
  )
| to_entries
| sort_by(-.value.total_commits)
| .[0:5]
| from_entries
