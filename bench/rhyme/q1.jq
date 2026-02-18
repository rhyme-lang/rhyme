reduce (inputs | .[]) as $c (
    {};
    ($c.commit.author.name)      as $author |
    ($c.commit.author.date[0:4]) as $year   |
    ($c.commit.author.date[0:7]) as $month  |
    .[$author].email //= $c.commit.author.email |
    .[$author].total_commits                       += 1 |
    .[$author].yearly_activity[$year].total_commits          += 1 |
    .[$author].yearly_activity[$year].monthly_activity[$month].total_commits += 1
  )
| to_entries
| sort_by(-.value.total_commits)
| .[0:5]
| from_entries
