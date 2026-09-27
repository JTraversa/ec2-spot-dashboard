// Sources and background for the charts page. The site-wide footer
// (license, privacy, contact) is SiteFooter.
const ext = { target: '_blank', rel: 'noopener noreferrer' }

export default function Sources() {
  return (
    <section className="dashboard-sources" aria-label="Sources">
      <p className="sources-note">
        AWS EC2 prices depend on how you buy. <strong>Spot</strong> prices move with spare capacity: from 2009 to 2017 through an{' '}
        <a href="https://www.researchgate.net/publication/221276558" {...ext}>auction</a>, and since November 2017 through an{' '}
        <a href="https://www.researchgate.net/publication/333939795" {...ext}>algorithm-based supply and demand model</a>{' '}
        (Baughman et al.). <strong>On-demand</strong> and <strong>reserved instance</strong> prices are set by AWS and change rarely.
      </p>
      <div className="sources-grid">
        <div className="sources-col">
          <h4>Spot price data</h4>
          <ul>
            <li><a href="https://zenodo.org/records/15003060" {...ext}>USC/ISI EC2 Spot Price Archive</a>: 2014 to 2023 (Calvin Ardi), <a href="https://zenodo.org/records/15003060" {...ext}>DOI: 10.5281/zenodo.15003060</a></li>
            <li><a href="https://zenodo.org/records/18821638" {...ext}>AWS Spot Price History</a>: May 2022 to January 2024 (Eric Pauley)</li>
            <li><a href="https://arxiv.org/pdf/2202.02973" {...ext}>SpotLake</a>: AWS, Google Cloud and Azure, 2024 to August 2026</li>
            <li><a href="https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_DescribeSpotPriceHistory.html" {...ext}>AWS DescribeSpotPriceHistory API</a>: rolling 90 days, collected daily</li>
            <li>Google Compute Engine Capacity Advisor: up to one year of spot price changes, collected daily</li>
            <li>Azure Resource Graph spot price history: rolling 90 days, collected daily</li>
          </ul>
        </div>
        <div className="sources-col">
          <h4>On-demand and reserved data</h4>
          <ul>
            <li><a href="https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/using-the-aws-price-list-bulk-api.html" {...ext}>AWS Price List Bulk API</a>: list prices since 2015; reserved instance history since 2016 in us-east-1, us-west-2 and eu-west-1</li>
            <li>On-demand, 1-year and 3-year reserved (no upfront) prices for every tracked instance type</li>
          </ul>
        </div>
        <div className="sources-col">
          <h4>Research</h4>
          <ul>
            <li><a href="https://www.researchgate.net/publication/221276558" {...ext}>Ben-Yehuda et al. (2011)</a>: deconstructing EC2 spot pricing</li>
            <li><a href="https://www.researchgate.net/publication/333939795" {...ext}>Baughman et al. (2019)</a>: the 2017 spot market changes</li>
            <li><a href="https://www.researchgate.net/publication/373331751" {...ext}>Fragiadakis et al. (2023)</a>: ML price prediction</li>
            <li><a href="https://arxiv.org/pdf/2202.02973" {...ext}>SpotLake (2022)</a>: a multi-cloud spot dataset archive</li>
          </ul>
        </div>
      </div>
    </section>
  )
}
