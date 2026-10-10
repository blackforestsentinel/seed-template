using System.Runtime.CompilerServices;
using System.Security.Claims;
using System.Text;
using Api.Jobs;
using Azure;
using Bfs.Seed.Storage;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;

namespace Api.Tests;

public class JobFunctionsTests
{
    private const string ObjectId = "aaaaaaaa-1111-2222-3333-444444444444";

    private readonly FakeJobTable jobs = new();
    private readonly FakeQueue queue = new();
    private readonly CancellationToken cancellationToken = TestContext.Current.CancellationToken;

    private JobFunctions Functions => new(jobs, queue, NullLogger<JobFunctions>.Instance);

    [Fact]
    public async Task Create_StoresStatusAndQueuesMessage()
    {
        var result = Assert.IsType<AcceptedResult>(await Functions.Create(Request("""{"input":"hallo"}"""), cancellationToken));

        var response = Assert.IsType<JobResponse>(result.Value);
        Assert.Equal(JobStatus.Queued, response.Status);
        var (queueName, message) = Assert.Single(queue.Sent);
        Assert.Equal(JobFunctions.QueueName, queueName);
        Assert.Equal(new JobMessage("anonymous", response.Id), message);
        Assert.Equal("hallo", jobs.Rows[("anonymous", response.Id)].Input);
    }

    [Fact]
    public async Task Create_SignedIn_UsesObjectIdAsPartition()
    {
        var result = Assert.IsType<AcceptedResult>(await Functions.Create(Request("""{"input":"hallo"}""", ObjectId), cancellationToken));

        var id = Assert.IsType<JobResponse>(result.Value).Id;
        Assert.True(jobs.Rows.ContainsKey((ObjectId, id)));
    }

    [Theory]
    [InlineData("""{"input":""}""")]
    [InlineData("""{}""")]
    public async Task Create_WithoutInput_IsRejected(string body)
    {
        Assert.IsType<BadRequestObjectResult>(await Functions.Create(Request(body), cancellationToken));
        Assert.Empty(queue.Sent);
    }

    [Fact]
    public async Task Get_OnlyFindsOwnJobs()
    {
        var id = Guid.NewGuid().ToString("N");
        jobs.Rows[(ObjectId, id)] = new JobStatus { PartitionKey = ObjectId, RowKey = id, Input = "x" };

        Assert.IsType<OkObjectResult>(await Functions.Get(Request(null, ObjectId), id, cancellationToken));
        Assert.IsType<NotFoundResult>(await Functions.Get(Request(null), id, cancellationToken));
        Assert.IsType<NotFoundResult>(await Functions.Get(Request(null, ObjectId), "../other", cancellationToken));
    }

    [Fact]
    public async Task Process_SetsResultAndCountsAttempts()
    {
        jobs.Rows[("p", "1")] = new JobStatus { PartitionKey = "p", RowKey = "1", Input = "hallo" };

        await Functions.Process(new JobMessage("p", "1"), cancellationToken);

        var job = jobs.Rows[("p", "1")];
        Assert.Equal((JobStatus.Done, "HALLO", 1), (job.Status, job.Result, job.Attempts));
    }

    [Fact]
    public async Task Process_SameMessageTwice_LeavesDoneJobAlone()
    {
        jobs.Rows[("p", "1")] = new JobStatus { PartitionKey = "p", RowKey = "1", Input = "hallo" };

        await Functions.Process(new JobMessage("p", "1"), cancellationToken);
        await Functions.Process(new JobMessage("p", "1"), cancellationToken);

        Assert.Equal(1, jobs.Rows[("p", "1")].Attempts);
    }

    [Fact]
    public async Task Process_UnknownJob_IsIgnored()
    {
        await Functions.Process(new JobMessage("p", "missing"), cancellationToken);

        Assert.Empty(jobs.Rows);
    }

    private static HttpRequest Request(string? json, string? objectId = null)
    {
        var context = new DefaultHttpContext();
        if (objectId is not null)
        {
            context.User = new ClaimsPrincipal(new ClaimsIdentity([new Claim("oid", objectId)], "Bearer"));
        }

        if (json is not null)
        {
            context.Request.ContentType = "application/json";
            context.Request.Body = new MemoryStream(Encoding.UTF8.GetBytes(json));
        }

        return context.Request;
    }

    /// <summary>Tabelle im Speicher; jede Schreiboperation vergibt einen neuen ETag.</summary>
    private sealed class FakeJobTable : ISeedTableRepository<JobStatus>
    {
        public Dictionary<(string, string), JobStatus> Rows { get; } = [];

        public string TableName => JobStatus.TableName;

        public Task<JobStatus?> GetAsync(string partitionKey, string rowKey, CancellationToken cancellationToken = default) =>
            Task.FromResult(Rows.TryGetValue((partitionKey, rowKey), out var job) ? Copy(job) : null);

        public Task<JobStatus> AddAsync(JobStatus entity, CancellationToken cancellationToken = default)
        {
            entity.ETag = new ETag(Guid.NewGuid().ToString());
            Rows.Add((entity.PartitionKey, entity.RowKey), Copy(entity));
            return Task.FromResult(entity);
        }

        public Task<JobStatus> UpdateAsync(JobStatus entity, CancellationToken cancellationToken = default) => UpsertAsync(entity, cancellationToken);

        public Task<JobStatus> UpsertAsync(JobStatus entity, CancellationToken cancellationToken = default)
        {
            entity.ETag = new ETag(Guid.NewGuid().ToString());
            Rows[(entity.PartitionKey, entity.RowKey)] = Copy(entity);
            return Task.FromResult(entity);
        }

        public async Task<JobStatus?> ModifyAsync(string partitionKey, string rowKey, Func<JobStatus, bool> change, CancellationToken cancellationToken = default)
        {
            var job = await GetAsync(partitionKey, rowKey, cancellationToken);
            return job is null || !change(job) ? job : await UpdateAsync(job, cancellationToken);
        }

        public Task<bool> DeleteAsync(JobStatus entity, CancellationToken cancellationToken = default) =>
            Task.FromResult(Rows.Remove((entity.PartitionKey, entity.RowKey)));

        public IAsyncEnumerable<JobStatus> QueryPartitionAsync(string partitionKey, CancellationToken cancellationToken = default) =>
            Query(Rows.Values.Where(j => j.PartitionKey == partitionKey));

        public IAsyncEnumerable<JobStatus> QueryAsync(string? filter, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        private static async IAsyncEnumerable<JobStatus> Query(IEnumerable<JobStatus> rows, [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            foreach (var row in rows.ToList())
            {
                await Task.Yield();
                yield return Copy(row);
            }
        }

        private static JobStatus Copy(JobStatus j) => new()
        {
            PartitionKey = j.PartitionKey,
            RowKey = j.RowKey,
            ETag = j.ETag,
            Status = j.Status,
            Input = j.Input,
            Result = j.Result,
            Attempts = j.Attempts,
        };
    }

    private sealed class FakeQueue : ISeedQueueSender
    {
        public List<(string Queue, object Message)> Sent { get; } = [];

        public Task<string> SendAsync<T>(string queueName, T message, TimeSpan? visibilityDelay = null, CancellationToken cancellationToken = default)
        {
            Sent.Add((queueName, message!));
            return Task.FromResult(Guid.NewGuid().ToString());
        }
    }
}
