reduce (inputs | .[]) as $c (
    {};
    ($c.commit.author.name) as $author |
    .[$author].email = $c.commit.author.email |
    .[$author].total_commits += 1 |
    .[$author].merge_commits //= 0 |
    if ($c.parents | length) > 1 then
      .[$author].merge_commits += 1
    else
      .
    end
  )
| to_entries
| sort_by(-.value.merge_commits)
| from_entries