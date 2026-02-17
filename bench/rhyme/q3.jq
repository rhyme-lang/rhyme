reduce (inputs | .[]) as $c (
    {};
    ($c.commit.author.date[11:13]) as $hour   |
    ($c.commit.author.name)        as $author |
    .[$hour].total_commits += 1 |
    .[$hour].authors[$author] = true
  )
| map_values({
    total_commits,
    unique_authors: (.authors | length)
  })
| to_entries
| sort_by(-.value.unique_authors)
| from_entries